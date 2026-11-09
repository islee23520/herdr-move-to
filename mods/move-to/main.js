import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, hc, exec, run, theme, props, closeOverlay, notify } from "herdr";

const rid = (p) => p + [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const bare = (id) => id.slice(id.lastIndexOf("/") + 1);
const sleep = (ms) => exec("sleep", [String(ms / 1000)]);

async function moveTerminal(terminal, space, tab) {
  run("terminal.park", { terminal });
  for (let i = 0; i < 40 && panes().some((p) => p.terminal === terminal); i++) await sleep(150);
  const r = await hc(["label", terminal, `herdr.space=${bare(space)}`, `herdr.tab=${bare(tab)}`]);
  if (r.code !== 0) throw new Error(r.stdout || r.stderr);
  await hc(["keep", terminal]);
}

function context() {
  const all = spaces();
  const p = props() ?? {};
  const tg = p.target ?? {};
  const fromTab = p.tab === "tab";
  const pane = tg.pane ? panes().find((x) => x.pane === tg.pane) : fromTab ? null : panes().find((x) => x.focused);
  const tabId = fromTab ? tg.id : pane?.tab;
  for (const s of all) {
    const tab = s.tabs.find((t) => t.id === tabId);
    if (tab) return { all, pane, space: s, tab };
  }
  return { all, pane: null, space: all.find((s) => s.active), tab: null };
}

function targets() {
  const { all, pane, space, tab } = context();
  const out = [];
  if (!tab) return out;
  const same = all.filter((s) => s.machine === space.machine);
  const prefix = space.machine ? `${space.machine}/` : "";
  const tabTerms = panes().filter((p) => p.tab === tab.id && p.terminal).map((p) => p.terminal);
  const tabName = tab.name || "tab";
  const where = space.machine ? ` (${space.machine})` : "";
  const add = (group, title, words, go, done) => out.push({ group, title: title + where, words, go, done });
  add("Tab", `Move tab “${tabName}” to a new space`, "workspace", () => { const sp = prefix + rid("sp"), tb = prefix + rid("tb"); return Promise.all(tabTerms.map((t) => moveTerminal(t, sp, tb))); }, "Tab moved to a new space");
  for (const s of same.filter((s) => s.id !== space.id)) {
    add("Tab", `Move tab “${tabName}” to space ${s.name}`, "workspace", () => { const tb = prefix + rid("tb"); return Promise.all(tabTerms.map((t) => moveTerminal(t, s.id, tb))); }, `Tab moved to ${s.name}`);
  }
  if (pane?.terminal) {
    add("Pane", "Move pane to a new tab", "break out", () => moveTerminal(pane.terminal, space.id, prefix + rid("tb")), "Pane moved to a new tab");
    add("Pane", "Move pane to a new space", "workspace break out", () => moveTerminal(pane.terminal, prefix + rid("sp"), prefix + rid("tb")), "Pane moved to a new space");
    for (const s of same) {
      for (const t of s.tabs) {
        if (t.id === tab.id) continue;
        add("Pane", `Move pane to ${s.name} › ${t.name || "tab"}`, "join", () => moveTerminal(pane.terminal, s.id, t.id), `Pane moved to ${s.name}`);
      }
      if (s.id !== space.id) add("Pane", `Move pane to a new tab in ${s.name}`, "", () => moveTerminal(pane.terminal, s.id, prefix + rid("tb")), `Pane moved to ${s.name}`);
    }
  }
  return out;
}

export default class MoveTo extends View {
  init() {
    this.query = "";
    this.at = 0;
    this.busy = false;
    this.input = InputState.new({ placeholder: "Move this tab or pane to…" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value().trim().toLowerCase().replace(/\s+/g, ""); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.pick(this.rows()[this.at]));
    this.input.focus();
  }

  rows() {
    const all = targets();
    if (!this.query) return all;
    return all.filter((e) => {
      const hay = `${e.title} ${e.words}`.toLowerCase().replace(/\s+/g, "");
      let i = 0;
      for (const ch of this.query) { i = hay.indexOf(ch, i); if (i < 0) return false; i++; }
      return true;
    });
  }

  async pick(e) {
    if (!e || this.busy) return;
    this.busy = true;
    const overlay = props().overlay;
    try {
      await e.go();
      notify({ title: e.done, level: "success", timeout: 2500 });
    } catch (err) {
      notify({ title: "Move failed", body: String(err?.message ?? err), level: "error" });
    }
    closeOverlay(overlay);
  }

  render() {
    const t = theme();
    const rows = this.rows();
    this.at = Math.min(this.at, Math.max(0, rows.length - 1));
    return v_flex().id("move-to").size_full().min_h(0).p(16).gap(10).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); return; }
        if (e.key === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (e.key === "up") this.at = Math.max(this.at - 1, 0);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(34).flex_none().px(10).gap(10).items_center().border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
        .child(div().text_size(11).text_color(t.dim).child("Enter · Esc")))
      .child(v_flex().id("move-to-list").flex_1().min_h(0).overflow_y_scrollbar()
        .children(rows.length ? rows.map((e, i) =>
          h_flex().id(`mv-${i}`).h(30).flex_none().px(10).gap(10).items_center().cursor_pointer().text_size(12.8)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click(() => this.pick(e))
            .child(div().flex_1().min_w(0).truncate().child(e.title))
            .child(div().text_size(11.5).text_color(t.dim).child(e.group)))
          : [div().px(10).py(12).text_size(13).text_color(t.dim).child(this.query ? "Nothing matches." : "Nothing to move here.")]));
  }
}
