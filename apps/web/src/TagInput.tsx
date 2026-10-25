import { useState } from "react";
const suggestions = ["character", "setting", "item", "vehicle"];
export function TagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = (tag: string) => {
    const tags = tag
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (
      tags.some((t) => t.length > 32) ||
      new Set([...value, ...tags]).size > 20
    )
      return;
    onChange([...new Set([...value, ...tags])]);
    setDraft("");
  };
  return (
    <fieldset className="tags-editor">
      <legend>Tags</legend>
      <div className="tag-list">
        {value.map((tag) => (
          <button
            type="button"
            key={tag}
            aria-label={`Remove tag ${tag}`}
            onClick={() => onChange(value.filter((t) => t !== tag))}
          >
            {tag} ×
          </button>
        ))}
      </div>
      <label>
        Add tags
        <input
          aria-label="Add tags"
          value={draft}
          maxLength={200}
          placeholder="e.g. setting, tavern"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
        />
      </label>
      <button type="button" disabled={!draft.trim()} onClick={() => add(draft)}>
        Add tag
      </button>
      <div className="tag-list">
        {suggestions
          .filter((tag) => !value.includes(tag))
          .map((tag) => (
            <button type="button" key={tag} onClick={() => add(tag)}>
              + {tag}
            </button>
          ))}
      </div>
      <small>Labels only · up to 20 tags, 32 characters each.</small>
    </fieldset>
  );
}
