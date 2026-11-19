package rag

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/net/html"
)

var blockedPrefixes = []netip.Prefix{
	// IPv4 RFC 6890 non-global / special-purpose ranges
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	// IPv6 RFC 6890 non-global / special-purpose / transition ranges
	netip.MustParsePrefix("::/96"),
	netip.MustParsePrefix("::ffff:0:0/96"),
	netip.MustParsePrefix("::ffff:0:0:0/96"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/32"),
	netip.MustParsePrefix("2001:2::/48"),
	netip.MustParsePrefix("2001:10::/28"),
	netip.MustParsePrefix("2001:20::/28"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
	netip.MustParsePrefix("fec0::/10"),
	netip.MustParsePrefix("ff00::/8"),
}

func isPublicIP(ip net.IP) (netip.Addr, bool) {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return netip.Addr{}, false
	}
	addr = addr.Unmap()
	if !addr.IsValid() || addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() || addr.IsUnspecified() || addr.IsInterfaceLocalMulticast() {
		return netip.Addr{}, false
	}
	for _, p := range blockedPrefixes {
		if p.Contains(addr) {
			return netip.Addr{}, false
		}
	}
	return addr, true
}

// Resolve and pin each connection, including redirect targets, to validated public IPs.
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
	validated := make([]netip.Addr, 0, len(ips))
	for _, a := range ips {
		addr, ok := isPublicIP(a.IP)
		if !ok {
			return nil, errors.New("仅允许公开互联网地址")
		}
		validated = append(validated, addr)
	}
	if len(validated) == 0 {
		return nil, errors.New("仅允许公开互联网地址")
	}
	d := net.Dialer{Timeout: 10 * time.Second}
	var lastErr error
	for _, addr := range validated {
		conn, err := d.DialContext(ctx, network, net.JoinHostPort(addr.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
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

func parseMediaType(header string) string {
	mediaType, _, err := mime.ParseMediaType(header)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(mediaType))
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
	tr := &http.Transport{DialContext: publicDial, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 15 * time.Second, MaxResponseHeaderBytes: 1 << 20, DisableKeepAlives: true}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 35 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) >= 4 {
			return errors.New("网页重定向过多")
		}
		if len(via) > 0 && via[len(via)-1].URL.Scheme == "https" && r.URL.Scheme != "https" {
			return errors.New("禁止从HTTPS降级重定向至HTTP")
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
		log.Printf("fetchPublicBytes %s failed: %v", raw, e)
		return out, errors.New("网页读取失败：请检查公开地址，或改用上传文件")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return out, errors.New("网页未返回成功内容，请改用上传或补录")
	}
	data, e := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if e != nil || len(data) == 0 || int64(len(data)) > limit {
		return out, fmt.Errorf("网页或文档为空、读取失败或超过%dMiB", limit>>20)
	}
	out = WebSnapshot{Data: data, URL: resp.Request.URL.String(), Filename: filepath.Base(resp.Request.URL.Path), MediaType: parseMediaType(resp.Header.Get("Content-Type"))}
	return out, nil
}

// Keep original HTML bytes intact; the parser reads this bounded image manifest.
func CachePublicImages(ctx context.Context, snapshot WebSnapshot, directory, stem string) error {
	if snapshot.MediaType != "text/html" && snapshot.MediaType != "application/xhtml+xml" {
		return nil
	}
	base, err := url.Parse(snapshot.URL)
	if err != nil || base == nil {
		return errors.New("网页基础地址无效")
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	tokenizer := html.NewTokenizer(bytes.NewReader(snapshot.Data))
	manifest := map[string]map[string]string{}
	count := 0
	total := 0
	downloaded := 0
	for {
		tokType := tokenizer.Next()
		if tokType == html.ErrorToken {
			if err := tokenizer.Err(); err != nil && !errors.Is(err, io.EOF) {
				return err
			}
			break
		}
		if tokType != html.StartTagToken && tokType != html.SelfClosingTagToken {
			continue
		}
		tok := tokenizer.Token()
		switch tok.Data {
		case "base":
			for _, a := range tok.Attr {
				if a.Key == "href" && strings.TrimSpace(a.Val) != "" {
					if u, err := url.Parse(strings.TrimSpace(a.Val)); err == nil {
						resolved := base.ResolveReference(u)
						if _, err := validPublicURL(resolved.String()); err == nil {
							base = resolved
						}
					}
					break
				}
			}
		case "img":
			var src string
			for _, a := range tok.Attr {
				if a.Key == "src" {
					src = a.Val
					break
				}
			}
			trimmed := strings.TrimSpace(src)
			if trimmed != "" && !strings.HasPrefix(strings.ToLower(trimmed), "data:") && manifest[src] == nil && len(manifest) < 50 {
				entry := map[string]string{}
				manifest[src] = entry
				u, err := url.Parse(trimmed)
				if err != nil {
					entry["error"] = "无效图像地址"
				} else if count >= 12 || total >= 20<<20 || downloaded >= 20<<20 {
					entry["error"] = "图片超过单页12张／20MiB上限，请单独上传"
				} else {
					resolved := base.ResolveReference(u).String()
					entry["url"] = resolved
					img, err := fetchPublicBytes(ctx, resolved, 5<<20)
					if err != nil {
						entry["error"] = err.Error()
					} else {
						downloaded += len(img.Data)
						if total+len(img.Data) > 20<<20 {
							entry["error"] = "图片超过单页12张／20MiB上限，请单独上传"
						} else {
							ext := ""
							switch parseMediaType(http.DetectContentType(img.Data)) {
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
								count++
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
		}
	}
	data, _ := json.Marshal(manifest)
	return os.WriteFile(filepath.Join(directory, stem+"_images.json"), data, 0600)
}
