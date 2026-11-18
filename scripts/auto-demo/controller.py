"""Native Windows demo controller. The teaching website receives no overlay code."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import messagebox, ttk

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FLOWS = json.loads((HERE / 'flows.json').read_text(encoding='utf-8'))
BG, PANEL, TEXT, MUTED, ACCENT = '#171b22', '#242b35', '#f4f5f7', '#b3bdca', '#f3a45b'
TITLE = 'HaJi Mark 演示控制台'


class Controller:
    def __init__(self, *, test=False):
        self.root = tk.Tk()
        self.root.title(TITLE)
        self.root.geometry('430x690+55+80')
        self.root.minsize(410, 600)
        self.root.configure(bg=BG)
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(2, weight=1)
        self.root.attributes('-topmost', True)
        self.root.protocol('WM_DELETE_WINDOW', self.hide)
        self.queue = queue.Queue()
        self.proc = None
        self.busy = self.paused = self.visible = False
        self.snapshot = {}
        style = ttk.Style()
        style.theme_use('clam')
        style.configure('Demo.Treeview', background=PANEL, foreground=TEXT, fieldbackground=PANEL, borderwidth=0, rowheight=32, font=('Microsoft YaHei UI', 11))
        style.map('Demo.Treeview', background=[('selected', '#4a372c')], foreground=[('selected', TEXT)])
        style.configure('Demo.Horizontal.TProgressbar', background=ACCENT, troughcolor=PANEL, borderwidth=0)
        top = tk.Frame(self.root, bg=BG)
        top.grid(row=0, column=0, sticky='ew', padx=20, pady=(20, 10))
        tk.Label(top, text='HaJi Mark', fg=TEXT, bg=BG, font=('Segoe UI', 19, 'bold')).pack(side='left')
        self.btn(top, '隐藏', self.hide, compact=True).pack(side='right')
        self.course = tk.StringVar(value='数据库系统原理')
        tk.Label(self.root, textvariable=self.course, anchor='w', fg=MUTED, bg=BG, font=('Microsoft YaHei UI', 10), wraplength=385).grid(row=1, column=0, sticky='ew', padx=20, pady=(0, 12))
        listing = tk.Frame(self.root, bg=BG)
        listing.grid(row=2, column=0, sticky='nsew', padx=20)
        self.tree = ttk.Treeview(listing, show='tree', selectmode='browse', style='Demo.Treeview', height=12)
        scroll = ttk.Scrollbar(listing, orient='vertical', command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.pack(side='left', fill='both', expand=True)
        scroll.pack(side='right', fill='y')
        for i, f in enumerate(FLOWS, 1):
            self.tree.insert('', 'end', iid=f['id'], text=f'{i:02d}  {f["title"]}')
        self.tree.selection_set(FLOWS[0]['id'])
        self.tree.bind('<<TreeviewSelect>>', self.select)
        self.tree.bind('<Return>', lambda _: self.run(False))
        self.detail = tk.StringVar()
        tk.Label(self.root, textvariable=self.detail, fg=MUTED, bg=BG, justify='left', anchor='w', wraplength=385, font=('Microsoft YaHei UI', 10)).grid(row=3, column=0, sticky='ew', padx=20, pady=12)
        controls = tk.Frame(self.root, bg=BG)
        controls.grid(row=4, column=0, sticky='ew', padx=20)
        self.run_one = self.btn(controls, '演示所选', lambda: self.run(False), primary=True)
        self.run_one.pack(side='left', fill='x', expand=True, padx=(0, 8))
        self.run_all = self.btn(controls, '连续演示', lambda: self.run(True))
        self.run_all.pack(side='left', fill='x', expand=True)
        secondary = tk.Frame(self.root, bg=BG)
        secondary.grid(row=5, column=0, sticky='ew', padx=20, pady=(8, 12))
        self.pause_btn = self.btn(secondary, '暂停 / 接管', self.pause, compact=True)
        self.pause_btn.pack(side='left')
        self.stop_btn = self.btn(secondary, '停止', lambda: self.send('stop'), compact=True)
        self.stop_btn.pack(side='left', padx=8)
        self.btn(secondary, '浏览器', lambda: self.send('show'), compact=True).pack(side='left')
        self.btn(secondary, '新批次', self.new_run, compact=True).pack(side='right')
        self.progress = ttk.Progressbar(self.root, style='Demo.Horizontal.TProgressbar', maximum=len(FLOWS))
        self.progress.grid(row=6, column=0, sticky='ew', padx=20)
        self.status = tk.StringVar(value='正在准备控制台…')
        tk.Label(self.root, textvariable=self.status, anchor='w', fg=TEXT, bg=BG, wraplength=385, font=('Microsoft YaHei UI', 10)).grid(row=7, column=0, sticky='ew', padx=20, pady=(10, 6))
        footer = tk.Frame(self.root, bg=BG)
        footer.grid(row=8, column=0, sticky='ew', padx=20, pady=(0, 15))
        self.shortcut = tk.StringVar(value='Ctrl + Alt + D')
        tk.Label(footer, textvariable=self.shortcut, fg=MUTED, bg=BG, font=('Segoe UI', 10)).pack(side='left')
        self.btn(footer, '记录', self.records, compact=True).pack(side='right')
        self.btn(footer, '退出', self.quit, compact=True).pack(side='right', padx=6)
        self.mini = tk.Toplevel(self.root)
        self.mini.title('HaJi Mark 演示进度')
        self.mini.configure(bg=BG)
        self.mini.geometry('440x102+55+80')
        self.mini.resizable(False, False)
        self.mini.attributes('-topmost', True)
        self.mini.protocol('WM_DELETE_WINDOW', self.hide)
        tk.Label(self.mini, textvariable=self.status, anchor='w', fg=TEXT, bg=BG, wraplength=415, font=('Microsoft YaHei UI', 10)).pack(fill='x', padx=12, pady=(10, 4))
        bar = tk.Frame(self.mini, bg=BG)
        bar.pack(fill='x', padx=12, pady=(0, 8))
        self.btn(bar, '展开', self.show, compact=True).pack(side='left')
        self.mini_pause = self.btn(bar, '暂停 / 接管', self.pause, compact=True)
        self.mini_pause.pack(side='left', padx=7)
        self.btn(bar, '停止', lambda: self.send('stop'), compact=True).pack(side='left')
        self.mini.withdraw()
        self.visible = True
        self.root.bind('<Escape>', lambda _: self.hide())
        self.root.bind('<Control-space>', lambda _: self.pause())
        self.hotkey = False
        if sys.platform == 'win32':
            self.hotkey = bool(ctypes.windll.user32.RegisterHotKey(None, 0x484A, 0x4003, ord('D')))
            if not self.hotkey:
                self.hotkey = bool(ctypes.windll.user32.RegisterHotKey(None, 0x484A, 0x4007, ord('D')))
                if self.hotkey:
                    self.shortcut.set('Ctrl + Alt + Shift + D')
        self.select()
        self.mini.bind('<Control-space>', lambda _: self.pause())
        self.root.after(80, self.poll)
        if not test:
            self.start_runner()

    def btn(self, parent, text, command, *, primary=False, compact=False):
        return tk.Button(parent, text=text, command=command, fg=BG if primary else TEXT, bg=ACCENT if primary else PANEL, activebackground='#f7bb82' if primary else '#354152', activeforeground=BG if primary else TEXT, relief='flat', borderwidth=0, padx=9 if compact else 14, pady=5 if compact else 10, font=('Microsoft YaHei UI', 9 if compact else 11), cursor='hand2', highlightthickness=2, highlightbackground=BG, highlightcolor=ACCENT, takefocus=True)

    def select(self, *_):
        selected = self.tree.selection()
        if not selected:
            return
        f = next(f for f in FLOWS if f['id'] == selected[0])
        self.detail.set(f'{f["input"]}\n↓ {f["process"]}\n→ {f["output"]}')
        self.controls()

    def start_runner(self):
        env = dict(os.environ, PYTHONIOENCODING='utf-8')
        self.proc = subprocess.Popen([os.environ.get('HAJIMARK_NODE', 'node'), str(HERE / 'runner.cjs')], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', bufsize=1, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), env=env)
        def read(stream, json_lines):
            for line in stream:
                try:
                    item = json.loads(line) if json_lines else {'type': 'runner_log', 'message': line.strip()}
                except json.JSONDecodeError:
                    item = {'type': 'runner_log', 'message': line.strip()}
                self.queue.put(item)
            if json_lines:
                self.queue.put({'type': 'runner_exit'})
        threading.Thread(target=read, args=(self.proc.stdout, True), daemon=True).start()
        threading.Thread(target=read, args=(self.proc.stderr, False), daemon=True).start()

    def send(self, command, **fields):
        if not self.proc or self.proc.poll() is not None:
            self.status.set('演示进程未运行，请重新打开控制台')
            return
        try:
            self.proc.stdin.write(json.dumps({'command': command, **fields}, ensure_ascii=False) + '\n')
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError):
            self.status.set('演示进程已结束，请重新打开控制台')

    def run(self, all_flows):
        if self.busy:
            return
        selected = self.tree.selection()
        if not selected:
            return
        flow = 'all' if all_flows else selected[0]
        states = self.snapshot.get('flows', {})
        retry_failed = any(v.get('state') == 'failed' for v in states.values()) if all_flows else states.get(flow, {}).get('state') == 'failed'
        if retry_failed and not messagebox.askyesno('继续失败流程', '已完成的写入会复用。若模型任务已明确失败，将保留失败记录并重新调用，可能产生费用；结果未知的写入不会重发。是否继续？', parent=self.root):
            return
        self.busy = True
        self.status.set('正在打开真实浏览器…')
        self.controls()
        self.send('run', flow=flow, retry_failed=retry_failed)
        self.root.withdraw()
        self.visible = False
        self.mini.deiconify()

    def pause(self):
        if self.busy:
            self.send('resume' if self.paused else 'pause')

    def controls(self):
        states = self.snapshot.get('flows', {})
        selected = self.tree.selection()
        saved = bool(selected and states.get(selected[0], {}).get('state') == 'done')
        self.run_one.configure(text='查看结果' if saved else '演示所选')
        self.run_all.configure(text='浏览全部结果' if all(states.get(f['id'], {}).get('state') == 'done' for f in FLOWS) else '连续演示')
        for b in (self.run_one, self.run_all):
            b.configure(state='disabled' if self.busy else 'normal')
        for b in (self.pause_btn, self.mini_pause):
            b.configure(text='继续演示' if self.paused else '暂停 / 接管', state='normal' if self.busy else 'disabled')
        self.stop_btn.configure(state='normal' if self.busy else 'disabled')

    def new_run(self):
        if self.busy:
            messagebox.showinfo(TITLE, '请先停止当前演示。', parent=self.root)
        elif messagebox.askyesno('创建新演示批次', '将新建独立课程并重新执行真实写入和模型调用，可能产生费用。\n已有课程和回执全部保留。是否继续？', parent=self.root):
            self.send('new')

    def show(self):
        self.mini.withdraw()
        self.root.deiconify()
        self.root.lift()
        self.visible = True

    def hide(self):
        self.root.withdraw()
        self.visible = False
        if self.busy:
            self.mini.deiconify()
        else:
            self.mini.withdraw()

    def records(self):
        target = ROOT / '.local' / 'auto-demo' / self.snapshot.get('id', '')
        if target.exists():
            os.startfile(target)

    def poll(self):
        if self.hotkey:
            msg = wintypes.MSG()
            while ctypes.windll.user32.PeekMessageW(ctypes.byref(msg), None, 0x0312, 0x0312, 1):
                self.hide() if self.visible else self.show()
        for _ in range(100):
            try:
                event = self.queue.get_nowait()
            except queue.Empty:
                break
            typ = event.get('type')
            if 'snapshot' in event:
                self.snapshot = event['snapshot']
                self.course.set(self.snapshot.get('course', '数据库系统原理'))
                states = self.snapshot.get('flows', {})
                for i, f in enumerate(FLOWS, 1):
                    state = states.get(f['id'], {}).get('state', '')
                    badge = {'done': '✓', 'running': '▶', 'failed': '!', 'stopped': 'Ⅱ'}.get(state, ' ')
                    self.tree.item(f['id'], text=f'{i:02d} {badge}  {f["title"]}')
                self.progress['value'] = sum(v.get('state') == 'done' for v in states.values())
            if typ == 'ready':
                self.status.set('选择一条流程开始' if self.hotkey else '快捷键被占用；控制窗仍可操作')
            elif typ in ('step', 'flow', 'saved', 'stopping', 'browser'):
                self.status.set(event.get('label', ''))
            elif typ == 'waiting':
                self.status.set(f'{event.get("label", "")} · {event.get("state") or "等待结果"}')
            elif typ == 'paused':
                self.paused = True
                self.status.set('暂停请求已发送；当前操作收尾后可接管，后台任务继续')
            elif typ == 'resumed':
                self.paused = False
                self.status.set('继续演示')
            elif typ == 'idle':
                self.busy = self.paused = False
            elif typ in ('error', 'stopped'):
                self.busy = self.paused = False
                self.status.set((event.get('message') or '已停止').splitlines()[0][:180])
                self.show()
            elif typ == 'complete':
                self.status.set(event['label'] + ' · 已核对落库')
            elif typ == 'runner_exit':
                self.busy = self.paused = False
                self.status.set('演示进程已退出')
                self.show()
            elif typ == 'runner_log':
                log = ROOT / '.local' / 'auto-demo' / 'controller.log'
                log.parent.mkdir(parents=True, exist_ok=True)
                with log.open('a', encoding='utf-8') as file:
                    file.write(event.get('message', '') + '\n')
            self.controls()
        self.root.after(80, self.poll)

    def quit(self):
        if self.busy and not messagebox.askyesno(TITLE, '停止演示并退出？已提交的后台任务继续保留。', parent=self.root):
            return
        if self.hotkey:
            ctypes.windll.user32.UnregisterHotKey(None, 0x484A)
        if self.proc and self.proc.poll() is None:
            self.send('shutdown')
        self.root.destroy()


def main():
    if '--self-test' in sys.argv:
        app = Controller(test=True)
        app.root.update()
        app.hide(); app.root.update(); assert app.root.state() == 'withdrawn'
        app.show(); app.root.update(); assert app.root.state() == 'normal'
        if app.hotkey:
            ctypes.windll.user32.PostThreadMessageW(ctypes.windll.kernel32.GetCurrentThreadId(), 0x0312, 0x484A, 0)
            app.poll(); assert not app.visible
            app.show()
        app.busy = True; app.controls(); assert app.run_one['state'] == 'disabled'
        app.busy = False; app.controls()
        app.root.geometry('410x600')
        app.root.update()
        for flow in FLOWS:
            app.tree.selection_set(flow['id']); app.select(); app.root.update()
            footer = app.root.grid_slaves(row=8)[0]
            assert footer.winfo_ismapped() and app.progress.winfo_ismapped()
            assert footer.winfo_y() + footer.winfo_height() <= app.root.winfo_height()
        print(json.dumps({'native_window': True, 'hotkey_registered': app.hotkey, 'toggle': True, 'busy_guard': True, 'minimum_layout': True}))
        app.quit()
        return
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel.CloseHandle.restype = wintypes.BOOL
    mutex = kernel.CreateMutexW(None, False, 'Local\\HaJiMarkAutoDemoController')
    if not mutex:
        raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error() == 183:
        hwnd = ctypes.windll.user32.FindWindowW(None, TITLE)
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 9)
            ctypes.windll.user32.SetForegroundWindow(hwnd)
        kernel.CloseHandle(mutex)
        return
    app = Controller()
    try:
        app.root.mainloop()
    finally:
        kernel.CloseHandle(mutex)


if __name__ == '__main__':
    main()
