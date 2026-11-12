"""SVG drawing and obstacle-aware orthogonal routing for the design atlas."""
from html import escape
from pathlib import Path
import heapq
import re
from PIL import ImageFont

HERE = Path(__file__).resolve().parent
BG, INK, MUTED = "#F7F6F2", "#242424", "#58616A"
PALETTE = {
    "system": ("#FFFFFF", "#BFCACB", INK, MUTED),
    "teacher": ("#303235", "#303235", "#FFFFFF", "#E1E5E8"),
    "ai": ("#FFF1E5", "#E3B89A", INK, "#775D4E"),
    "data": ("#EAF1F5", "#AFC9DA", INK, "#526575"),
    "external": ("#F0F0EA", "#BCC3BA", INK, MUTED),
    "pending": ("#F1F1EF", "#929B9E", "#697278", "#697278"),
}
FONTS = {}


def measure(s, size=22):
    if size not in FONTS:
        FONTS[size] = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)
    return FONTS[size].getlength(s)


def wrap(s, width, size=22):
    lines = []
    for part in s.split("|"):
        line = ""
        tokens = re.findall(r"[A-Za-z0-9_./:+%?-]+|[^\x00-\x7f]|\s+|.", part)
        for token in tokens:
            # Keep identifiers and paths intact when they fit. Long paths break
            # at separators before falling back to character-level wrapping.
            pieces = [token] if measure(token, size) <= width else re.findall(r"[A-Za-z0-9_]+|.", token)
            for piece in pieces:
                chunks = [piece] if measure(piece, size) <= width else list(piece)
                for chunk in chunks:
                    if line and measure(line + chunk, size) > width:
                        lines.append(line.rstrip())
                        line = chunk.lstrip()
                    else:
                        line += chunk if line else chunk.lstrip()
        lines.append(line.rstrip())
    return lines


def text(x, y, value, size=22, color=INK, weight=400, anchor="start", **attrs):
    extra = " ".join(f'{k.rstrip("_").replace("_", "-")}="{escape(str(v), quote=True)}"' for k, v in attrs.items())
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}" {extra}>{escape(str(value))}</text>'


def rect(x, y, w, h, fill, stroke="none", **attrs):
    extra = " ".join(f'{k.rstrip("_").replace("_", "-")}="{escape(str(v), quote=True)}"' for k, v in attrs.items())
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}" {extra}/>'


def intersects(a, b, pad=0):
    x, y, w, h = a
    X, Y, W, H = b
    return x < X + W + pad and X < x + w + pad and y < Y + H + pad and Y < y + h + pad


def blocked_segment(p, q, obstacles):
    x1, y1 = p
    x2, y2 = q
    for x, y, w, h in obstacles:
        if x1 == x2 and x < x1 < x + w and max(min(y1, y2), y) < min(max(y1, y2), y + h):
            return True
        if y1 == y2 and y < y1 < y + h and max(min(x1, x2), x) < min(max(x1, x2), x + w):
            return True
    return False


class Diagram:
    def __init__(self, fid, title, question, cols=4, rows=4, evidence="", boundary="", width=None, row_step=360):
        self.id, self.title, self.question = fid, title, question
        self.cols, self.rows, self.row_step = cols, rows, row_step
        self.width = width or (2700 if cols == 4 else 2520 if cols == 3 else 2500)
        self.margin, self.top, self.gap = 80, 275, 140
        self.nw = (self.width - 160 - self.gap * (cols - 1)) / cols
        self.nodes, self.links, self.zones = {}, [], []
        self.evidence, self.boundary = evidence, boundary

    def node(self, key, col, row, title, lines=(), role="system", status=None, x=None, y=None, w=None, h=None):
        x = self.margin + col * (self.nw + self.gap) if x is None else x
        y = self.top + row * self.row_step if y is None else y
        w = self.nw if w is None else w
        body, body_starts = [], []
        for line in lines:
            wrapped = wrap(line, w - 58, 22)
            body.extend(wrapped)
            body_starts.extend([True] + [False] * (len(wrapped) - 1))
        h = max(176, 91 + len(body) * 32) if h is None else h
        assert 91 + len(body) * 32 <= h + 8, (self.id, key, "height")
        assert measure(title, 27) < w - 40, (self.id, key, "title width", title)
        assert key not in self.nodes
        self.nodes[key] = dict(key=key, x=x, y=y, w=w, h=h, title=title, body=body, body_starts=body_starts, role=role, status=status)
        return key

    def edge(self, a, b, label="", dashed=False, sides=None):
        assert a in self.nodes and b in self.nodes, (self.id, a, b)
        self.links.append(dict(a=a, b=b, label=label, dashed=dashed, sides=sides))

    def chain(self, keys, labels=()):
        for i, (a, b) in enumerate(zip(keys, keys[1:])):
            self.edge(a, b, labels[i] if i < len(labels) else "")

    def zone(self, label, col, row, cols=1, rows=1, color="#EDEDE7"):
        self.zones.append((label, 55 + col * (self.nw + self.gap), self.top - 52 + row * self.row_step,
                           self.nw * cols + self.gap * (cols - 1) + 50, rows * self.row_step - 40, color))

    def _route(self):
        rects = [(n["x"] - 12, n["y"] - 12, n["w"] + 24, n["h"] + 24) for n in self.nodes.values()]
        xs = {38., self.width - 38.}
        ys = {230., self.top + self.rows * self.row_step - 35.}
        for n in self.nodes.values():
            for d in (-45, -22, 22, 45):
                xs.add(n["x"] + (0 if d < 0 else n["w"]) + d)
                ys.add(n["y"] + (0 if d < 0 else n["h"]) + d)
        ports, counts = [], {}
        for link in self.links:
            a, b = self.nodes[link["a"]], self.nodes[link["b"]]
            dx, dy = b["x"] - a["x"], b["y"] - a["y"]
            sa, sb = link["sides"] or (("r", "l") if abs(dx) > abs(dy) * 1.25 else ("b", "t") if dy > 0 else ("t", "b"))
            if not link["sides"] and dy == 0 and dx < 0:
                sa, sb = "l", "r"
            def port(n, side):
                idx = counts.get((n["key"], side), 0)
                counts[n["key"], side] = idx + 1
                offset = (0, 29, -29, 58, -58, 80, -80)[idx % 7]
                if side in "lr":
                    p = (n["x"] if side == "l" else n["x"] + n["w"], n["y"] + n["h"] / 2 + offset)
                    q = (p[0] + (-22 if side == "l" else 22), p[1])
                else:
                    p = (n["x"] + n["w"] / 2 + offset, n["y"] if side == "t" else n["y"] + n["h"])
                    q = (p[0], p[1] + (-22 if side == "t" else 22))
                xs.add(q[0]); ys.add(q[1])
                return p, q
            ports.append((port(a, sa), port(b, sb)))
        xs, ys = sorted(xs), sorted(ys)
        xmap, ymap = {x:i for i,x in enumerate(xs)}, {y:i for i,y in enumerate(ys)}
        occupied = {}
        neighbors_cache = {}
        def neighbors(p):
            if p in neighbors_cache:
                return neighbors_cache[p]
            xi, yi = xmap[p[0]], ymap[p[1]]
            result = []
            for i, j in ((xi-1, yi),(xi+1, yi),(xi,yi-1),(xi,yi+1)):
                if 0 <= i < len(xs) and 0 <= j < len(ys):
                    q = (xs[i], ys[j])
                    if not blocked_segment(p, q, rects):
                        result.append(q)
            neighbors_cache[p] = result
            return result
        for link, ((pa, start), (pb, end)) in zip(self.links, ports):
            queue = [(0, 0, start, 0)]
            dist, previous, serial = {(start, 0): 0}, {}, 0
            final = None
            while queue:
                _, cost, p, direction = heapq.heappop(queue)
                state = p, direction
                if cost != dist.get(state):
                    continue
                if p == end:
                    final = state
                    break
                for q in neighbors(p):
                    d = 1 if q[1] == p[1] else 2
                    segment = tuple(sorted((p, q)))
                    length = abs(q[0]-p[0]) + abs(q[1]-p[1])
                    newcost = cost + length + (55 if direction and d != direction else 0) + occupied.get(segment, 0) * (25 + length * .6)
                    nextstate = q, d
                    if newcost < dist.get(nextstate, float("inf")):
                        dist[nextstate] = newcost
                        previous[nextstate] = state
                        heuristic = abs(end[0]-q[0]) + abs(end[1]-q[1])
                        serial += 1
                        heapq.heappush(queue, (newcost + heuristic, newcost, q, d))
            if final is None:
                raise ValueError((self.id, "no route", link["a"], link["b"]))
            path = []
            state = final
            while state in previous:
                path.append(state[0]); state = previous[state]
            path.append(start); path.reverse()
            for p, q in zip(path,path[1:]):
                segment = tuple(sorted((p,q)))
                occupied[segment] = occupied.get(segment,0) + 1
            path = [pa] + path + [pb]
            simplified = []
            for p in path:
                if simplified and p == simplified[-1]:
                    continue
                while len(simplified)>1 and ((simplified[-2][0]==simplified[-1][0]==p[0]) or (simplified[-2][1]==simplified[-1][1]==p[1])):
                    simplified.pop()
                simplified.append(p)
            link["path"] = simplified

    def render(self):
        self._route()
        bottom = max(n["y"] + n["h"] for n in self.nodes.values())
        bottom = max(bottom, max(p[1] for l in self.links for p in l["path"]))
        footer = bottom + 92
        notes = wrap(self.boundary, self.width-210, 23)
        sources = wrap("源码核查：" + self.evidence, self.width-210, 19)
        height = footer + len(notes)*32 + len(sources)*27 + 115
        out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{height}" viewBox="0 0 {self.width} {height}" role="img" aria-labelledby="title desc">',
               f'<title id="title">{escape(self.id+" "+self.title)}</title><desc id="desc">{escape(self.question+"。"+self.boundary)}</desc>',
               '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 1 L9 5 L0 9Z" fill="#85929B"/></marker></defs>',
               f'<g font-family="Microsoft YaHei, sans-serif">', rect(0,0,self.width,height,BG),
               text(80,76,self.id+"　"+self.title,40,weight=700),
               text(self.width-80,76,"2026-11-12 · 本地工作树",22,MUTED,anchor="end"),
               text(80,125,self.question,25,MUTED),
               text(80,177,"教师深色 / AI橙色 / 数据蓝色 / 系统白色　　绿色标记：本地已接通　　灰色虚框：未实现",22,MUTED),
               text(80,214,"箭头按本图语义表达；只代表代码路径与结构，不代表独立教师验收、模型正确性或公网部署。",20,"#8A622E")]
        for label,x,y,w,h,color in self.zones:
            out += [rect(x,y,w,h,color,"#B8C4C3",stroke_dasharray="10 7",stroke_width=2), text(x+18,y+31,label,22,MUTED,600)]
        out.append('<g class="edges">')
        for i,l in enumerate(self.links):
            d = "M" + " L".join(f'{x},{y}' for x,y in l["path"])
            dash = ' stroke-dasharray="10 7"' if l["dashed"] else ""
            out.append(f'<g class="edge" data-from="{l["a"]}" data-to="{l["b"]}"><title>{escape(self.nodes[l["a"]]["title"]+" → "+self.nodes[l["b"]]["title"]+"："+l["label"])}</title><path d="{d}" stroke="#85929B" stroke-width="2.7" stroke-linejoin="round" fill="none" marker-end="url(#arrow)"{dash}/></g>')
        out.append('</g><g class="nodes">')
        for n in self.nodes.values():
            x,y,w,h,role = (n[k] for k in ("x","y","w","h","role"))
            fill,stroke,fg,muted = PALETTE[role]
            out += [f'<g class="node" data-node="{n["key"]}" data-role="{role}">',
                    rect(x,y,w,h,fill,stroke,stroke_width=2,stroke_dasharray="10 7" if role=="pending" else "none"),
                    text(x+22,y+43,n["title"],27,fg,650,class_="node-title")]
            status = n["status"] or ("未实现" if role=="pending" else "外部边界" if role=="external" else "持久数据" if role=="data" else "人工关口" if role=="teacher" else "本地接通")
            color = "#78818A" if role in ("pending","external") else "#187653"
            sw = measure(status,17)+22
            out += [rect(x+w-sw-13,y-14,sw,29,"#E3F0E9" if color=="#187653" else "#EBEDF0"), text(x+w-sw/2-13,y+7,status,17,color,600,"middle")]
            for i,line in enumerate(n["body"]):
                cy=y+85+i*32
                if n["body_starts"][i]:
                    out.append(f'<circle cx="{x+27}" cy="{cy-7}" r="4" fill="{color}"/>')
                out.append(text(x+40,cy,line,22,muted,class_="node-line"))
            out.append('</g>')
        out.append('</g><g class="labels">')
        labels=[]
        for l in self.links:
            if not l["label"]:
                continue
            w=measure(l["label"],20)+20; h=30
            candidates=[]
            for p,q in zip(l["path"],l["path"][1:]):
                if p[1]==q[1] and abs(q[0]-p[0])>w+10:
                    for fraction in (.5,.3,.7):
                        candidates.append((p[0]+(q[0]-p[0])*fraction-w/2,p[1]-35,w,h))
                if p[0]==q[0] and abs(q[1]-p[1])>40:
                    for fraction in (.5,.3,.7):
                        candidates += [(p[0]+10,p[1]+(q[1]-p[1])*fraction-15,w,h),(p[0]-w-10,p[1]+(q[1]-p[1])*fraction-15,w,h)]
            obstacles=[(n["x"]-5,n["y"]-18,n["w"]+10,n["h"]+23) for n in self.nodes.values()]+labels
            chosen=next((c for c in candidates if 20<c[0] and c[0]+c[2]<self.width-20 and c[1]>225 and not any(intersects(c,o,6) for o in obstacles)),None)
            if chosen is None:
                # Short-edge semantics remain in the SVG title and gallery list.
                continue
            labels.append(chosen)
            x,y,w,h=chosen
            out += [f'<g class="edge-label" data-from="{l["a"]}" data-to="{l["b"]}">',rect(x,y,w,h,BG),text(x+w/2,y+22,l["label"],20,"#526575",anchor="middle"),'</g>']
        out.append('</g>')
        out += [rect(80,footer-32,self.width-160,len(notes)*32+24,"#EAE9E3")]
        for i,line in enumerate(notes):
            out.append(text(103,footer+i*32,line,23,MUTED))
        sy=footer+len(notes)*32+38
        for i,line in enumerate(sources):
            out.append(text(80,sy+i*27,line,19,MUTED))
        out.append(text(80,height-25,f'{len(self.nodes)} 个节点 · {len(self.links)} 条关系　｜　细节见同编号分图；SVG 可搜索、放大，PNG 用于展示。',18,MUTED))
        out.append('</g></svg>')
        self.validate()
        return "\n".join(out), {"id":self.id,"title":self.title,"question":self.question,"evidence":self.evidence,"boundary":self.boundary,"nodes":len(self.nodes),"edges":len(self.links),"width":self.width,"height":height,"relations":[{"from":l["a"],"to":l["b"],"label":l["label"]} for l in self.links]}

    def validate(self):
        for key,n in self.nodes.items():
            for key2,m in self.nodes.items():
                if key>=key2:
                    continue
                assert not intersects(tuple(n[k] for k in ("x","y","w","h")),tuple(m[k] for k in ("x","y","w","h"))), (self.id,key,key2,"node overlap")
        for l in self.links:
            unrelated=[tuple(n[k] for k in ("x","y","w","h")) for k,n in self.nodes.items() if k not in (l["a"],l["b"])]
            for p,q in zip(l["path"],l["path"][1:]):
                assert not blocked_segment(p,q,unrelated),(self.id,l["a"],l["b"],"edge crosses node")


def save(diagram):
    svg,meta=diagram.render()
    (HERE/(diagram.id+".svg")).write_text(svg,encoding="utf-8")
    print(f'{diagram.id}: {meta["nodes"]} nodes / {meta["edges"]} edges',flush=True)
    return meta
