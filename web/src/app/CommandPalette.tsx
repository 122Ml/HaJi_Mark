import { useEffect, useMemo, useRef, useState } from "react";
import { Input, Modal } from "antd";
import type { InputRef } from "antd";
import { useNavigate } from "react-router-dom";
import type { NavigationGroup } from "./navigation";
import { useThemeMode } from "./theme-mode";

interface CommandItem {
  id: string;
  group: string;
  label: string;
  hint: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  root: string;
  groups: NavigationGroup[];
  withCourse: (path: string) => string;
}

export function CommandPalette({
  open,
  onClose,
  root,
  groups,
  withCourse,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const { mode, toggleMode } = useThemeMode();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<InputRef>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo<CommandItem[]>(() => {
    const navItems: CommandItem[] = groups.flatMap((group) =>
      group.links.map(([path, label]) => ({
        id: `${group.label}:${path}`,
        group: group.label,
        label,
        hint: `/${path}`,
        run: () => navigate(withCourse(`${root}/${path}`)),
      })),
    );
    navItems.push(
      {
        id: "account:profile",
        group: "账户与外观",
        label: "个人设置",
        hint: "/profile",
        run: () => navigate(withCourse(`${root}/profile`)),
      },
      {
        id: "theme:toggle",
        group: "账户与外观",
        label: mode === "dark" ? "切换为浅色模式" : "切换为深色模式",
        hint: mode === "dark" ? "Light" : "Dark",
        run: () => toggleMode(),
      },
    );
    return navItems;
  }, [groups, mode, navigate, root, toggleMode, withCourse]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setActiveIndex((prev) => (filtered.length === 0 ? 0 : Math.min(prev, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const activeEl = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, filtered.length]);

  function execute(item: CommandItem | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={520}
      className="lab-palette"
      destroyOnHidden
      aria-label="快捷命令栏"
    >
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((prev) =>
              filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0,
            );
          } else if (event.key === "Enter") {
            event.preventDefault();
            execute(filtered[activeIndex]);
          }
        }}
        placeholder="搜索页面、功能模块或切换明暗模式…"
        suffix={<kbd>Esc</kbd>}
        aria-label="搜索命令"
      />
      <ul ref={listRef} className="lab-palette-list" role="listbox" aria-label="快捷命令列表">
        {filtered.length === 0 ? (
          <li className="lab-palette-empty">未找到匹配项</li>
        ) : (
          filtered.map((item, idx) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                role="option"
                aria-selected={idx === activeIndex}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={(event) => {
                  event.preventDefault();
                  execute(item);
                }}
              >
                <span>
                  <span className="lab-palette-group">{item.group}</span>
                  <strong>{item.label}</strong>
                </span>
                <small>{item.hint}</small>
              </a>
            </li>
          ))
        )}
      </ul>
      <div className="lab-palette-foot">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> 选择
        </span>
        <span>
          <kbd>↵</kbd> 跳转
        </span>
        <span>
          <kbd>Esc</kbd> 关闭
        </span>
      </div>
    </Modal>
  );
}
