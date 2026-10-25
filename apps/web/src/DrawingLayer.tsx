import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { DoubleSide, CircleGeometry, Plane, Vector2, Vector3 } from "three";
import { Html } from "@react-three/drei";
import {
  DRAWING_LIMIT,
  type Drawing,
  type DrawingStroke,
} from "@wikitop/shared";
export interface InkPreview {
  connectionId: string;
  boardId: string;
  actorId: string;
  name: string;
  color: string;
  width: number;
  points: [number, number][];
  strokeId?: string;
  cursor?: [number, number];
  updatedAt: number;
}
export interface DrawingInteraction {
  active: boolean;
  tool: "pen" | "eraser";
  color: string;
  width: number;
  actorId: string;
  previews: InkPreview[];
  onStroke: (stroke: DrawingStroke) => void;
  onErase: (id: string) => void;
  onPreview: (
    points: [number, number][],
    cursor?: [number, number],
    strokeId?: string,
  ) => void;
}
function InkStroke({ stroke }: { stroke: DrawingStroke }) {
  const signature = JSON.stringify(stroke);
  const geometry = useMemo(() => {
    const [x, y] = stroke.points[0];
    if (stroke.points.length === 1)
      return new CircleGeometry(stroke.width / 2, 16);
    const points = stroke.points.map((p) => new Vector2(p[0] - x, p[1] - y));
    return (
      SVGLoader.pointsToStroke(
        points,
        SVGLoader.getStrokeStyle(stroke.width, stroke.color, "round", "round"),
        8,
        0.00001,
      ) ?? new CircleGeometry(stroke.width / 2, 16)
    );
  }, [signature]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      position={[...stroke.points[0], 0.025]}
      geometry={geometry}
      raycast={() => {}}
      renderOrder={1}
    >
      <meshBasicMaterial
        color={stroke.color}
        side={DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}
export default function DrawingLayer({
  drawing,
  width,
  depth,
  interaction,
}: {
  drawing?: Drawing;
  width: number;
  depth: number;
  interaction?: DrawingInteraction;
}) {
  const [local, setLocal] = useState<DrawingStroke>();
  const stroke = useRef<DrawingStroke>();
  const last = useRef(0);
  const previews = interaction?.previews ?? [];
  const strokes = [
    ...(drawing?.strokes ?? []),
    ...previews
      .filter(
        (p) =>
          p.strokeId &&
          !drawing?.strokes.some((s) => s.id === p.strokeId) &&
          p.points.length,
      )
      .map((p) => ({
        id: p.strokeId!,
        authorId: p.actorId,
        color: p.color,
        width: p.width,
        points: p.points,
      })),
    ...(local ? [local] : []),
  ];
  useEffect(() => {
    stroke.current = undefined;
    setLocal(undefined);
  }, [interaction?.active]);
  const point = (e: any): [number, number] => {
    const v = new Vector3();
    e.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), v);
    return [
      Math.round(
        Math.max(-DRAWING_LIMIT, Math.min(DRAWING_LIMIT, v.x)) * 1000,
      ) / 1000,
      Math.round(
        Math.max(-DRAWING_LIMIT, Math.min(DRAWING_LIMIT, v.y)) * 1000,
      ) / 1000,
    ];
  };
  const erase = (p: [number, number]) => {
    const hit = [...(drawing?.strokes ?? [])].reverse().find((s) =>
      s.points.some((a, i) => {
        const b = s.points[Math.min(i + 1, s.points.length - 1)],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          t = Math.max(
            0,
            Math.min(
              1,
              ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) /
                (dx * dx + dy * dy || 1),
            ),
          );
        return (
          Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <
          Math.max(0.15, s.width / 2)
        );
      }),
    );
    if (hit) interaction?.onErase(hit.id);
  };
  return (
    <group>
      {strokes.map((stroke) => (
        <InkStroke key={stroke.id} stroke={stroke} />
      ))}
      {previews.map(
        (p) =>
          p.cursor && (
            <Html
              key={p.connectionId}
              position={[...p.cursor, 0.05]}
              style={{ pointerEvents: "none" }}
            >
              <span
                style={{
                  color: p.color,
                  background: "#191f22",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                }}
              >
                ✎ {p.name}
              </span>
            </Html>
          ),
      )}
      {interaction?.active && (
        <mesh
          position={[0, 0, 0.06]}
          renderOrder={10}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button !== 0) return;
            const p = point(e);
            if (interaction.tool === "eraser") {
              erase(p);
              return;
            }
            stroke.current = {
              id: crypto.randomUUID(),
              authorId: interaction.actorId,
              color: interaction.color,
              width: interaction.width,
              points: [p],
            };
            setLocal({ ...stroke.current });
            (e.target as any).setPointerCapture(e.pointerId);
            interaction.onPreview([p], p, stroke.current.id);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            const p = point(e),
              s = stroke.current;
            if (
              s &&
              s.points.length < 512 &&
              Math.hypot(
                p[0] - s.points.at(-1)![0],
                p[1] - s.points.at(-1)![1],
              ) > 0.015
            ) {
              s.points.push(p);
              setLocal({ ...s });
            }
            if (Date.now() - last.current > 70) {
              last.current = Date.now();
              interaction.onPreview(s?.points ?? [], p, s?.id);
            }
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            if (!stroke.current) return;
            const s = stroke.current;
            stroke.current = undefined;
            setLocal(undefined);
            (e.target as any).releasePointerCapture(e.pointerId);
            interaction.onStroke(s);
            interaction.onPreview([]);
          }}
          onPointerCancel={() => {
            stroke.current = undefined;
            setLocal(undefined);
            interaction.onPreview([]);
          }}
        >
          <planeGeometry args={[DRAWING_LIMIT * 2, DRAWING_LIMIT * 2]} />
          <meshBasicMaterial
            transparent
            opacity={0}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}
