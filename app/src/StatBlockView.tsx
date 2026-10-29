import ReactMarkdown from "react-markdown";
import type { StatBlock } from "@wikitop/thing-format";

export default function StatBlockView({ block }: { block?: StatBlock }) {
  if (!block) return null;
  const groups = new Map<string, typeof block.fields>();
  for (const field of block.fields) {
    const key = field.group ?? "Statistics",
      list = groups.get(key) ?? [];
    list.push(field);
    groups.set(key, list);
  }
  return (
    <section className="stat-block">
      <header>
        <h3>Statistics</h3>
        {block.system && <span>{block.system}</span>}
      </header>
      {[...groups].map(([name, fields]) => (
        <div key={name}>
          <h4>{name}</h4>
          <dl>
            {fields.map((f) => (
              <div key={f.id}>
                <dt>{f.label}</dt>
                <dd>{String(f.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {block.resources.length > 0 && (
        <div>
          <h4>Resources</h4>
          <dl>
            {block.resources.map((r) => (
              <div key={r.id}>
                <dt>{r.label}</dt>
                <dd>
                  {r.value}
                  {r.max !== undefined ? ` / ${r.max}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {block.sections.map((s) => (
        <div key={s.id}>
          <h4>{s.name}</h4>
          {s.entries.map((e) => (
            <article key={e.id}>
              <strong>{e.name}.</strong>{" "}
              <ReactMarkdown skipHtml>{e.text}</ReactMarkdown>
            </article>
          ))}
        </div>
      ))}
      {block.source && <small>Source: {block.source}</small>}
    </section>
  );
}
