import type { Character } from "@wikitop/shared";
export default function CharacterCards({
  characters,
  selected,
  onSelect,
  onEdit,
  onCreate,
  currentIds,
  onToggleCurrent,
}: {
  characters: Character[];
  currentIds?: string[];
  onToggleCurrent?: (id: string) => void;
  selected?: string;
  onSelect?: (id: string) => void;
  onEdit: (id: string) => void;
  onCreate?: () => void;
}) {
  return (
    <div className="character-grid" aria-label="Your character cards">
      {characters.map((c) => (
        <div
          className={`character-card ${selected === c.id ? "selected" : ""}`}
          key={c.id}
        >
          <button
            aria-label={`${onSelect ? "Select" : "Edit"} character ${c.name}`}
            aria-pressed={onSelect ? selected === c.id : undefined}
            onClick={() => (onSelect ? onSelect(c.id) : onEdit(c.id))}
          >
            {c.assetId ? (
              <img
                alt=""
                src={
                  c.assetId.startsWith("sample_")
                    ? `/assets/${c.assetId}.svg`
                    : `/api/assets/${c.assetId}`
                }
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
            ) : (
              <span className="character-placeholder">◈</span>
            )}
            <h3>{c.name}</h3>
            <div className="tag-list">
              {c.tags?.map((tag) => (
                <span className="badge" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </button>
          {onToggleCurrent && (
            <label className="current-character-choice">
              <input
                type="checkbox"
                checked={currentIds?.includes(c.id) ?? false}
                onChange={() => onToggleCurrent(c.id)}
                aria-label={`Current character ${c.name}`}
              />
              Current character
            </label>
          )}
          {onSelect && (
            <button onClick={() => onEdit(c.id)}>Edit {c.name}</button>
          )}
        </div>
      ))}
      {onCreate && (
        <button className="new-character-card" onClick={onCreate}>
          <span>＋</span>New character
        </button>
      )}
    </div>
  );
}
