import DrawingLayer, { type DrawingInteraction } from "./DrawingLayer";
import { useSafeTexture, useSafeModel, MediaBoundary } from "./mediaResources";
import { Suspense, useRef, useEffect } from "react";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  Billboard,
  Grid,
  Html,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  useGLTF,
  useTexture,
} from "@react-three/drei";
import {
  OrthographicCamera as ThreeOrthographicCamera,
  DoubleSide,
  Plane,
  Vector3,
  MOUSE,
  type Group,
} from "three";
import type {
  AreaScene,
  Thing,
  Visual,
  Vec3,
  PlaySnapshot,
} from "@wikitop/shared";
const groundPlane = new Plane(new Vector3(0, 0, 1), 0);
export function assetUrl(id: string) {
  if (/^(https:|blob:|data:)/.test(id)) return id;
  return id.startsWith("sample_")
    ? `/assets/${id === "sample_model" ? "sample.glb" : `${id}.svg`}`
    : `/api/assets/${id}`;
}
function Model({ assetId = "sample_model" }: { assetId?: string }) {
  const scene = useSafeModel(assetUrl(assetId));
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <primitive object={scene.clone(true)} />
    </group>
  );
}
function ImageShape({ visual: v, map }: { visual: Visual; map: boolean }) {
  const texture = useSafeTexture(assetUrl(v.assetId!));
  const flat = v.mode === "token" || v.mode === "map" || map;
  const mesh = (
    <mesh
      position={
        flat
          ? [
              (0.5 - v.anchor[0]) * v.width,
              (0.5 - v.anchor[1]) * v.height,
              v.mode === "map" ? 0.005 : 0.075,
            ]
          : v.mode === "billboard"
            ? [(0.5 - v.anchor[0]) * v.width, (0.5 - v.anchor[1]) * v.height, 0]
            : [(0.5 - v.anchor[0]) * v.width, 0, (0.5 - v.anchor[1]) * v.height]
      }
      rotation={
        !flat && v.mode !== "billboard" ? [Math.PI / 2, 0, 0] : [0, 0, 0]
      }
      raycast={v.mode === "map" ? () => {} : undefined}
    >
      <planeGeometry args={[v.width, v.height]} />
      <meshBasicMaterial
        map={texture}
        // Maps render in the opaque pass so transparent tokens draw over them.
        transparent={v.mode !== "map"}
        side={DoubleSide}
        depthWrite={v.mode === "map"}
      />
    </mesh>
  );
  return v.mode === "billboard" && !map ? <Billboard>{mesh}</Billboard> : mesh;
}
function ThingObject({
  thing: t,
  map,
  selected,
  onSelect,
  onDrag,
  editing,
  disabled = false,
}: {
  disabled?: boolean;
  thing: Thing;
  map: boolean;
  selected?: string;
  onSelect: (id: string) => void;
  onDrag?: (id: string, p: Vec3) => void;
  editing: boolean;
}) {
  const dragging = useRef(false);
  const root = useRef<Group>(null);
  const v =
    map && t.visual?.mode === "model" && t.visual.mapAssetId
      ? { ...t.visual, mode: "token" as const, assetId: t.visual.mapAssetId }
      : t.visual;
  const point = (e: ThreeEvent<PointerEvent>) => {
    const p = new Vector3();
    if (e.ray.intersectPlane(groundPlane, p)) {
      root.current?.parent?.worldToLocal(p);
      onDrag?.(t.id, [p.x, p.y, t.position[2]]);
    }
  };
  const interactive = !disabled && v?.mode !== "map";
  return (
    <group
      ref={root}
      position={t.position}
      quaternion={t.rotation}
      scale={t.scale}
      onPointerDown={
        interactive
          ? (e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              onSelect(t.id);
              if (editing && onDrag) {
                dragging.current = true;
                (
                  e.target as unknown as {
                    setPointerCapture: (id: number) => void;
                  }
                ).setPointerCapture(e.pointerId);
              }
            }
          : undefined
      }
      onPointerMove={(e) => {
        if (dragging.current) {
          e.stopPropagation();
          point(e);
        }
      }}
      onPointerUp={(e) => {
        if (dragging.current) {
          dragging.current = false;
          (
            e.target as unknown as {
              releasePointerCapture: (id: number) => void;
            }
          ).releasePointerCapture(e.pointerId);
          point(e);
        }
      }}
    >
      <MediaBoundary key={`${v?.assetId}:${v?.mode}`} name={t.name}>
        {v?.mode === "model" ? (
          <Suspense
            fallback={
              <mesh>
                <octahedronGeometry />
                <meshStandardMaterial color="#d9a359" />
              </mesh>
            }
          >
            <Model assetId={v.assetId} />
          </Suspense>
        ) : v?.assetId ? (
          <Suspense
            fallback={
              <mesh>
                <boxGeometry args={[1, 1, 0.05]} />
                <meshBasicMaterial color="#aa8556" />
              </mesh>
            }
          >
            <ImageShape visual={v} map={map} />
          </Suspense>
        ) : (
          <mesh position={[0, 0, 0.15]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.35, 0.35, 0.3, 16]} />
            <meshStandardMaterial color="#af9464" />
          </mesh>
        )}
      </MediaBoundary>
      {selected === t.id && (
        <mesh position={[0, 0, 0.04]}>
          <ringGeometry
            args={[
              (v?.footprint[0] ?? 1) * 0.6,
              (v?.footprint[0] ?? 1) * 0.6 + 0.06,
              48,
            ]}
          />
          <meshBasicMaterial color="#ffdc8c" side={DoubleSide} />
        </mesh>
      )}
      {interactive && (
        <Html
          position={[0, 0, map ? 0.1 : (v?.height ?? 1) + 0.3]}
          center
          style={{ pointerEvents: "none" }}
        >
          <span className="scene-label">
            {t.name}
            {t.value !== undefined ? `: ${t.value}` : ""}
          </span>
        </Html>
      )}
      {editing &&
        t.children
          .filter((c) => c.role === "spatial")
          .map((c) => (
            <ThingObject
              key={c.id}
              thing={c}
              map={map}
              selected={selected}
              onSelect={onSelect}
              onDrag={onDrag}
              editing={editing}
            />
          ))}
    </group>
  );
}
function Occupant({
  disabled = false,
  occupant,
  map,
  self,
  selected,
  onSelect,
}: {
  disabled?: boolean;
  occupant: PlaySnapshot["occupants"][number];
  map: boolean;
  self: boolean;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const group = useRef<Group>(null);
  const position = occupant.placement.position;
  useFrame((_, dt) => {
    group.current?.position.lerp(
      new Vector3(...position),
      Math.min(1, dt * 12),
    );
  });
  const v: Visual = {
    mode: "billboard",
    assetId: occupant.character.assetId ?? "sample_token",
    width: 1.25,
    height: 1.65,
    anchor: [0.5, 0],
    footprint: [1, 1],
  };
  return (
    <group
      ref={group}
      position={position}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.stopPropagation();
        onSelect(occupant.character.id);
      }}
    >
      <MediaBoundary
        key={occupant.character.visual?.assetId ?? v.assetId}
        name={occupant.character.name}
      >
        <Suspense fallback={null}>
          {!map && occupant.character.visual?.mode === "model" ? (
            <Model assetId={occupant.character.visual.assetId} />
          ) : (
            <ImageShape visual={v} map={map} />
          )}
        </Suspense>
      </MediaBoundary>
      <mesh position={[0, 0, 0.045]}>
        <ringGeometry args={[0.65, 0.72, 40]} />
        <meshBasicMaterial
          color={
            selected === occupant.character.id
              ? "#ffffff"
              : self
                ? "#f7d68c"
                : "#83c9bd"
          }
          side={DoubleSide}
        />
      </mesh>
      <Html
        center
        position={[0, 0, map ? 0.15 : 2]}
        style={{ pointerEvents: "none" }}
      >
        <span className={`scene-label ${self ? "self" : ""}`}>
          {occupant.character.name}
        </span>
      </Html>
    </group>
  );
}
function InteriorBackground({
  id,
  width,
  height,
}: {
  id: string;
  width: number;
  height: number;
}) {
  const texture = useSafeTexture(assetUrl(id));
  const image = texture.image as { width: number; height: number };
  const aspect = image.width / image.height || 1;
  const w = Math.min(width, height * aspect),
    h = w / aspect;
  return (
    <ImageShape
      visual={{
        mode: "map",
        assetId: id,
        width: w,
        height: h,
        anchor: [0.5, 0.5],
        footprint: [w, h],
      }}
      map
    />
  );
}
function FitLayoutCamera({
  enabled,
  width,
  depth,
}: {
  enabled: boolean;
  width: number;
  depth: number;
}) {
  const camera = useThree((s) => s.camera),
    size = useThree((s) => s.size);
  useEffect(() => {
    if (enabled && camera instanceof ThreeOrthographicCamera) {
      camera.zoom = Math.max(
        1,
        Math.min((size.width - 24) / width, (size.height - 24) / depth),
      );
      camera.updateProjectionMatrix();
    }
  }, [enabled, width, depth, camera, size.width, size.height]);
  return null;
}
function FocusCamera({ signal, position }: { signal: number; position: Vec3 }) {
  const camera = useThree((s) => s.camera),
    controls = useThree((s) => s.controls);
  useEffect(() => {
    const orbit = controls as unknown as
      | { target: Vector3; update: () => void }
      | undefined;
    if (!orbit || !signal) return;
    const next = new Vector3(...position),
      delta = next.clone().sub(orbit.target);
    camera.position.add(delta);
    if (camera instanceof ThreeOrthographicCamera) {
      camera.position.x = next.x;
      camera.position.y = next.y;
    }
    orbit.target.copy(next);
    orbit.update();
  }, [signal, controls, camera]);
  return null;
}
export default function Scene({
  drawingInteraction,
  scene,
  map,
  selected,
  onSelect,
  onMove,
  onDrag,
  editing = false,
  snapshot,
  onDrawZone,
  interior = false,
  fit = false,
  backgroundAssetId,
  cameraMemory,
  focus = 0,
  focusPosition = [0, 0, 0],
}: {
  drawingInteraction?: DrawingInteraction;
  cameraMemory?: {
    value?: { position: number[]; target: number[]; zoom: number };
  };
  interior?: boolean;
  fit?: boolean;
  backgroundAssetId?: string;
  focus?: number;
  focusPosition?: Vec3;
  scene: AreaScene;
  map: boolean;
  selected?: string;
  onSelect: (id: string) => void;
  onMove?: (p: Vec3) => void;
  onDrag?: (id: string, p: Vec3) => void;
  editing?: boolean;
  snapshot?: PlaySnapshot;
  onDrawZone?: (start: Vec3, end: Vec3) => void;
}) {
  const drawStart = useRef<Vec3>();
  return (
    <Canvas
      shadows
      onContextMenu={(e) => e.preventDefault()}
      dpr={[1, 1.5]}
      aria-label={map ? "Top-down area map" : "Perspective area view"}
    >
      <color attach="background" args={["#191f22"]} />
      <ambientLight intensity={1.4} />
      <directionalLight position={[8, -5, 15]} intensity={2} />
      {map ? (
        <OrthographicCamera
          key="map"
          makeDefault
          far={60000}
          position={[0, 0, 30]}
          up={[0, 1, 0]}
          zoom={26}
          onUpdate={(c) => c.lookAt(0, 0, 0)}
        />
      ) : (
        <PerspectiveCamera
          key="3d"
          makeDefault
          far={60000}
          position={[14, -19, 15]}
          up={[0, 0, 1]}
          fov={48}
        />
      )}
      <OrbitControls
        makeDefault
        enableRotate={!map}
        mouseButtons={
          editing && !drawingInteraction?.active
            ? undefined
            : {
                LEFT: undefined,
                MIDDLE: map ? MOUSE.PAN : MOUSE.ROTATE,
                RIGHT: undefined,
              }
        }
        maxPolarAngle={Math.PI / 2 - 0.05}
        minDistance={4}
        maxDistance={20000}
        minZoom={0.02}
        maxZoom={1000}
      />
      {cameraMemory && <RememberCamera memory={cameraMemory} />}
      <FocusCamera signal={focus} position={focusPosition} />
      <FitLayoutCamera enabled={fit} width={scene.width} depth={scene.depth} />
      {backgroundAssetId && (
        <MediaBoundary key={backgroundAssetId} name="Background">
          <Suspense fallback={null}>
            <InteriorBackground
              id={backgroundAssetId}
              width={scene.width}
              height={scene.depth}
            />
          </Suspense>
        </MediaBoundary>
      )}
      <DrawingLayer
        drawing={snapshot?.view.drawing?.drawing ?? scene.drawing}
        width={scene.width}
        depth={scene.depth}
        interaction={drawingInteraction}
      />
      <Grid
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -0.03]}
        args={[scene.width, scene.depth]}
        cellSize={1}
        sectionSize={5}
        cellColor="#344045"
        sectionColor="#52615d"
        infiniteGrid
        followCamera
        fadeDistance={5000}
      />
      <mesh
        position={[0, 0, -0.04]}
        onPointerDown={(e) => {
          if (onDrawZone && e.button === 0) {
            e.stopPropagation();
            drawStart.current = [e.point.x, e.point.y, 0];
            (
              e.target as unknown as { setPointerCapture: (id: number) => void }
            ).setPointerCapture(e.pointerId);
          } else if (!editing && e.button === 2) {
            e.stopPropagation();
            if (!drawingInteraction?.active)
              onMove?.([e.point.x, e.point.y, 0]);
          }
        }}
        onPointerUp={(e) => {
          if (drawStart.current && onDrawZone) {
            e.stopPropagation();
            const end = new Vector3();
            e.ray.intersectPlane(groundPlane, end);
            onDrawZone(drawStart.current, [end.x, end.y, 0]);
            drawStart.current = undefined;
            (
              e.target as unknown as {
                releasePointerCapture: (id: number) => void;
              }
            ).releasePointerCapture(e.pointerId);
          }
        }}
      >
        <planeGeometry args={[scene.width, scene.depth]} />
        <meshStandardMaterial color="#242e2c" side={DoubleSide} />
      </mesh>
      {scene.things
        .filter((t) => interior || t.role === "spatial")
        .map((t) => (
          <ThingObject
            key={t.id}
            thing={t}
            disabled={drawingInteraction?.active}
            map={map}
            selected={selected}
            onSelect={drawingInteraction?.active ? () => {} : onSelect}
            onDrag={onDrag}
            editing={editing}
          />
        ))}
      {scene.zones.map((z) => (
        <group key={z.id} position={[z.x, z.y, 0.055]}>
          <mesh raycast={() => {}}>
            <planeGeometry args={[z.width, z.depth]} />
            <meshBasicMaterial
              color="#80aa9b"
              transparent
              opacity={editing ? 0.16 : 0.05}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
          <Html
            center
            position={[0, z.depth / 2 - 0.5, 0.02]}
            style={{ pointerEvents: "none" }}
          >
            <span className="zone-label">{z.name}</span>
          </Html>
        </group>
      ))}
      {scene.doors.map((d) => (
        <group
          key={d.id}
          position={d.position}
          onPointerDown={(e) => {
            if (drawingInteraction?.active || e.button !== 0) return;
            e.stopPropagation();
            if (!drawingInteraction?.active) onSelect(d.id);
          }}
        >
          <mesh position={[0, 0, 0.2]}>
            <boxGeometry args={[1.4, 0.5, 0.4]} />
            <meshStandardMaterial
              color={selected === d.id ? "#f8d48b" : "#b88452"}
            />
          </mesh>
          <Html center position={[0, 0, 0.5]} style={{ pointerEvents: "none" }}>
            <span className="scene-label">↗ {d.name}</span>
          </Html>
        </group>
      ))}
      {editing &&
        scene.anchors.map((a) => (
          <group
            key={a.id}
            position={a.position}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(a.id);
            }}
          >
            <mesh>
              <ringGeometry args={[0.35, 0.5, 20]} />
              <meshBasicMaterial color="#83c9bd" side={DoubleSide} />
            </mesh>
            <Html
              center
              position={[0, 0, 0.1]}
              style={{ pointerEvents: "none" }}
            >
              <span className="zone-label">⚑ {a.name}</span>
            </Html>
          </group>
        ))}
      {snapshot?.occupants.map((o) => (
        <Occupant
          key={`${o.character.id}-${o.placement.areaId}`}
          occupant={o}
          disabled={drawingInteraction?.active}
          map={map}
          self={o.character.id === snapshot.character.id}
          selected={selected}
          onSelect={drawingInteraction?.active ? () => {} : onSelect}
        />
      ))}
    </Canvas>
  );
}

function RememberCamera({
  memory,
}: {
  memory: { value?: { position: number[]; target: number[]; zoom: number } };
}) {
  const { camera, controls } = useThree();
  const initialized = useRef(false);
  useFrame(() => {
    const orbit = controls as unknown as {
      target: Vector3;
      update: () => void;
    };
    if (!orbit?.target) return;
    if (!initialized.current) {
      if (memory.value) {
        camera.position.fromArray(memory.value.position);
        orbit.target.fromArray(memory.value.target);
        if (camera instanceof ThreeOrthographicCamera)
          camera.zoom = memory.value.zoom;
        camera.updateProjectionMatrix();
        orbit.update();
      }
      initialized.current = true;
    }
    memory.value = {
      position: camera.position.toArray(),
      target: orbit.target.toArray(),
      zoom: camera instanceof ThreeOrthographicCamera ? camera.zoom : 1,
    };
  });
  return null;
}
