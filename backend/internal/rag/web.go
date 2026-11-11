package rag

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/net/html"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Resolve and pin each connection, including redirect targets, to a public IP.
func publicDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, e := net.SplitHostPort(address)
	if e != nil {
		return nil, e
	}
	ips, e := net.DefaultResolver.LookupIPAddr(ctx, host)
	if e != nil {
		return nil, e
	}
	if len(ips) == 0 {
		return nil, errors.New("网址没有可用地址")
	}
	for _, a := range ips {
		ip := a.IP
		if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.Equal(net.ParseIP("100.100.100.200")) || net.ParseIP("100.64.0.0").Equal(ip.Mask(net.CIDRMask(10, 32))) {
			return nil, errors.New("仅允许公开互联网地址")
		}
	}
	d := net.Dialer{Timeout: 10 * time.Second}
	return d.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
}
func validPublicURL(raw string) (*url.URL, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return nil, errors.New("请填写公开HTTP或HTTPS网址")
	}
	if p := u.Port(); p != "" && p != "80" && p != "443" {
		return nil, errors.New("仅支持标准网页端口")
	}
	return u, nil
}

type WebSnapshot struct {
	Data                     []byte
	URL, Filename, MediaType string
}

func FetchPublic(ctx context.Context, raw string) (WebSnapshot, error) {
	out, e := fetchPublicBytes(ctx, raw, 30<<20)
	if e != nil {
		return out, e
	}
	if out.MediaType == "text/html" || out.MediaType == "application/xhtml+xml" {
		out.Filename = "snapshot.html"
	} else {
		switch strings.ToLower(filepath.Ext(out.Filename)) {
		case ".pdf", ".docx", ".pptx", ".txt", ".md", ".csv":
		default:
			return WebSnapshot{}, errors.New("直链文档类型不支持")
		}
	}
	return out, nil
}

func fetchPublicBytes(ctx context.Context, raw string, limit int64) (WebSnapshot, error) {
	var out WebSnapshot
	if _, e := validPublicURL(raw); e != nil {
		return out, e
	}
	tr := &http.Transport{DialContext: publicDial, ResponseHeaderTimeout: 15 * time.Second, MaxResponseHeaderBytes: 1 << 20, DisableKeepAlives: true}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 35 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) >= 4 {
			return errors.New("网页重定向过多")
		}
		_, e := validPublicURL(r.URL.String())
		return e
	}}
	req, e := http.NewRequestWithContext(ctx, "GET", raw, nil)
	if e != nil {
		return out, e
	}
	req.Header.Set("User-Agent", "HaJiMark/1.0 (teacher-selected single-page import)")
	resp, e := client.Do(req)
	if e != nil {
		return out, errors.New("网页读取失败：请检查公开地址，或改用上传文件")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return out, errors.New("网页未返回成功内容，请改用上传或补录")
	}
	data, e := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if e != nil || len(data) == 0 || int64(len(data)) > limit {
		return out, errors.New("网页或文档为空、读取失败或超过30MiB")
	}
	out = WebSnapshot{Data: data, URL: resp.Request.URL.String(), Filename: filepath.Base(resp.Request.URL.Path), MediaType: strings.Split(resp.Header.Get("Content-Type"), ";")[0]}
	return out, nil
}

// Keep original HTML bytes intact; the parser reads this bounded image manifest.
func CachePublicImages(ctx context.Context, snapshot WebSnapshot, directory, stem string) error {
	if snapshot.MediaType != "text/html" && snapshot.MediaType != "application/xhtml+xml" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	root, e := html.Parse(bytes.NewReader(snapshot.Data))
	if e != nil {
		return e
	}
	base, _ := url.Parse(snapshot.URL)
	manifest := map[string]map[string]string{}
	count := 0
	total := 0
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "img" {
			var src string
			for _, a := range n.Attr {
				if a.Key == "src" {
					src = a.Val
				}
			}
			if src != "" && manifest[src] == nil {
				entry := map[string]string{}
				manifest[src] = entry
				u, err := url.Parse(src)
				if err != nil {
					entry["error"] = "无效图像地址"
				} else if count >= 12 || total >= 20<<20 {
					entry["error"] = "图片超过单页12张／20MiB上限，请单独上传"
				} else {
					count++
					raw := base.ResolveReference(u).String()
					entry["url"] = raw
					img, err := fetchPublicBytes(ctx, raw, 5<<20)
					if err != nil {
						entry["error"] = err.Error()
					} else {
						ext := ""
						switch http.DetectContentType(img.Data) {
						case "image/png":
							ext = ".png"
						case "image/jpeg":
							ext = ".jpg"
						case "image/gif":
							ext = ".gif"
						case "image/webp":
							ext = ".webp"
						}
						if ext == "" {
							entry["error"] = "仅支持PNG、JPEG、GIF或WebP图片"
						} else {
							name := fmt.Sprintf("%s_web_%d%s", stem, count, ext)
							if err = os.WriteFile(filepath.Join(directory, name), img.Data, 0600); err != nil {
								entry["error"] = "图片快照保存失败"
							} else {
								entry["path"] = name
								total += len(img.Data)
							}
						}
					}
				}
			}
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(root)
	data, _ := json.Marshal(manifest)
	return os.WriteFile(filepath.Join(directory, stem+"_images.json"), data, 0600)
}
