# WikiTop Shared World Design

WikiTop is a browser platform for building connected worlds and playing TTRPGs together. Authors publish areas; players inhabit them through synchronized 2D and 3D views with chat alongside the scene. Everything is composed of reusable objects called **Things**.

The platform supplies worldbuilding, presence, movement, inventories, visibility, and conversation. Players define their own attributes and conventions. HP, damage, combat, and other game rules have no built-in meaning.

## Authoring and live play

| Layer            | Responsibilities                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| Authoring        | Draft areas, descriptions, zones, Things, assets, and connections; invite collaborators; publish revisions |
| Live play        | Instantiate published areas with characters, placements, chat, and temporary scene changes                 |
| Personal library | Organize owned characters, items, and areas independently of their location                                |

Public areas can admit visitors without allowing edits. Private campaigns can use published areas with separate occupants and conversations. Live changes enter authored content only when an authorized author deliberately incorporates them into a draft.

A player's **physical location** and **viewed space** are separate. Entering yourself or peering into a permitted container opens its interior in the main 2D/3D viewport without moving the character. Back and breadcrumbs navigate views; **Return to character** always shows the joined character's latest room and centers on their token. Selecting other Things does not change that anchor. Explicit travel alone changes physical location; speech follows physical location.

Instances pin published revisions. Hosts apply updates deliberately, providing fallback placements for removed objects or zones. Restoring an authored revision does not rewind inventories or chat.

## Things and containment

Each Thing has a stable ID, name, description, owner, controllers, revision, and optional components. Components provide capabilities such as space, container, attribute, exit, or visual representation. Ownership manages content and delegation; control grants specific actions such as moving a character or driving a wagon.

Things nest: a character contains a bag containing a sword. Children can represent spatial occupants, inventory, attributes, or structural content. Only spatial children need transforms. Custom attributes have typed values and can contain further Things.

Containment is an acyclic tree, with at most one parent per Thing in an instance. Links form a separate graph; references can list Things without duplicating them. Movement preserves identity and ownership. Initially, each character has one active placement across live instances.

Nested JSON is the portable representation. The database stores individual Things and relationships so editing one object does not rewrite a world.

## Areas and zones

An **area** is a publishable Thing containing a scene, zones, objects, and connection points. Emberheart Tavern contains the Bar, Hearth, Dancefloor, Stage, and Booths. Stairs connect it to a separate Basement area.

A **zone** is a named region within a space. Authors draw boundaries; the server derives membership from accepted positions. Initially, occupants have one primary zone: priority resolves overlaps, then stable ID, with an area-wide fallback. Zones can scope visibility and chat without imposing game rules.

Spatial Things use local XYZ positions, quaternion rotation, and scale relative to their parent. Defaults are meters with Z up. The map uses X/Y coordinates: positive X is right, positive Y is up the map, and positive Z is elevation toward the top-down camera. Reparenting within a scene can preserve the world transform; travel uses the destination arrival anchor.

A wagon is a movable Thing with an interior space and optional zones. Moving its root moves riders and cargo through inherited transforms. A delegated driver controls travel; passengers retain control and ownership of their characters. Boundary crossings validate the entire subtree and commit atomically: everyone travels or nobody does.

## Connections and collaboration

Doors, stairs, and portals expose connection points. Authors can invite someone to create what lies beyond a point or link it to an area they manage.

1. The source author creates a connection point and invitation.
2. The invited author creates or selects an area and proposes an arrival point.
3. The proposal specifies direction and any return connection.
4. The source author accepts and publishes it, unless the invitation explicitly grants automatic acceptance.

Invitations grant scoped connection rights rather than general editing access. Each author retains ownership of their area. Connections reference stable endpoint IDs and have revisions; pending proposals do not affect published travel. Either endpoint owner can withdraw a connection. Destination admission is checked at travel time, and linking a private area does not make it public.

References open descriptions; exits request travel. Broken or inaccessible destinations fail safely without exposing private content. Federation between independently hosted servers is deferred.

## Shared 2D and 3D presentation

Use one scene and renderer with an orthographic map camera and a perspective 3D camera. Switching views preserves placement, selection, and conversation. Rendered objects are projections of authoritative Things.

| Assets          | Map view                    | 3D view                    |
| --------------- | --------------------------- | -------------------------- |
| Image           | Token or map surface        | Image on a card or surface |
| Model           | Top-down model or thumbnail | Model                      |
| Image and model | Preferred token image       | Model                      |
| Neither         | Labeled marker              | Labeled marker             |

Authors choose flat tokens, standing cards, camera-facing billboards, or map surfaces for images. Store dimensions, anchor, orientation, and selectable footprint independently of transparent image edges. A floor plan provides a usable scene without a modeled building; geometry can be added later.

Left-click selects and reads a Thing; right-click moves the selected Thing when permitted. The action inspector offers Take, Drop, Peer and Enter as capabilities allow. Opening yourself shows inventory and custom stats spatially in the main viewport. Controllers can manipulate live Things without gaining template editing rights.

Keep parent-facing representation separate from opened content: a character has a map token and optional full portrait; a tavern has a city-map pin and an interior floor plan; a city can appear as a pin on a region map. Items can have both token art and detailed artwork.

React panels provide chat, descriptions, inventories, the Thing inspector, and authoring tools. A visible manifest can simply list “Flask, Door to Kingsly Street, Stairs to Basement.” There is no separate text-only client or requirement to narrate spatial relationships.

Optional slash commands such as `/inspect flask` and `/go basement` invoke the same actions as graphical controls. Maintain keyboard access, readable labels, and reduced-motion options.

## Permissions and conversation

Centrally evaluate read, edit, manage, control, enter, transfer, chat, and moderate capabilities on the server. Permission inheritance stops at visiting Things' ownership boundaries unless explicitly delegated. Hosting a visitor does not grant ownership or editing rights over their character.

Things have independent **Visible** and **Peerable** flags. A visible backpack can be non-peerable, exposing its own representation while hiding all contents. Owners can inspect their own Things; delegated control does not bypass these flags. Characters start visible and peerable, while inventory starts private until its owner shares it. A peer view closes when its target leaves the character's room or viewing access is withdrawn.

Filter responses, subscriptions, search, and exports before delivery. A visible bag can have private contents. Zone chat and visual visibility are independent policies. Walls alone do not provide privacy; secret geometry must not be bundled into public assets.

Chat supports character speech, out-of-character messages, emotes, and room, zone, party, or direct channels. Messages record the acting account and displayed identity. History follows channel policy; arrival does not automatically expose earlier private conversation. Presence and typing are ephemeral.

Hosts can mute, ban, and evict visitors to a safe location without deleting their Things. Provide blocking, reporting, and administrative audit records before public discovery.

## Suggested technology stack

| Layer          | Recommendation                        | Purpose                                                           |
| -------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Language       | TypeScript                            | Shared types and commands                                         |
| Interface      | React and Vite                        | Authoring, chat, inspectors, and library                          |
| Spatial views  | Three.js, React Three Fiber, and Drei | Shared scene, cameras, tokens, cards, and models                  |
| Server         | Node.js and Fastify                   | HTTP API and authoritative commands                               |
| Live transport | Socket.IO                             | Authorized updates, chat, and presence                            |
| Persistence    | PostgreSQL and Drizzle                | Transactions, relationships, revisions, and JSONB components      |
| Validation     | Zod                                   | Commands and imported data                                        |
| Authentication | Better Auth                           | Accounts and sessions; Thing permissions remain application logic |
| Writing        | Tiptap                                | Descriptions and Thing references                                 |
| Assets         | S3-compatible object storage          | Images, maps, textures, and GLBs                                  |
| GLB pipeline   | glTF Transform                        | Metadata binding and import/export                                |
| Verification   | Vitest and Playwright                 | Domain invariants and multi-user browser flows                    |

Start with one persistent server, managed PostgreSQL, object storage, and a static frontend. Add Yjs with Hocuspocus for simultaneous prose editing later. Introduce Redis or separate services when deployment needs justify them.

Documentation: [React Three Fiber](https://r3f.docs.pmnd.rs/), [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/), [PostgreSQL JSONB](https://www.postgresql.org/docs/current/datatype-json.html), [Tiptap collaboration](https://tiptap.dev/docs/collaboration/getting-started/overview), and [glTF Transform](https://gltf-transform.dev/).

## State and synchronization

Clients send intentions such as MoveThing, TraverseExit, TransferThing, PublishArea, and AcceptConnection. The server validates permissions and revisions, commits changes, and distributes authorized updates. Graphical controls and slash commands share this command path.

Store Things, published revisions, placements, connections, permissions, messages, and asset references separately. Use JSONB for flexible components rather than entire worlds.

Durable changes and outbox events commit in one database transaction. Operation IDs deduplicate retries; revision checks prevent stale edits and transfers. Reconnecting clients receive missed authorized events or a fresh snapshot. Socket.IO supplies transport; durable replay and recovery remain application responsibilities.

Clients can predict movement and interpolate transient poses, then reconcile with the server. Accepted placements and travel are persisted. Transfers and vehicle travel use transactions; collaborative text merging applies only to prose.

## JSON and GLB portability

The standalone editor treats one self-contained GLB as one root Thing and its complete descendant tree. A versioned manifest in `asset.extras.WikiTop` contains the normalized Thing document, stable node bindings, and hashed references to media stored in GLB buffer views. Standard glTF nodes mirror containment for a useful preview in ordinary viewers; WikiTop restores the exact editable document and original media. Any subtree can be exported as its own root Thing.

Local editing runs without a server and autosaves working copies to IndexedDB. Opening replaces a working document; inserting remaps colliding identities and attaches the imported root beneath the viewed Thing. Generic GLBs become single model Things. Export requires all media to be embedded, and portable files never contain ownership, permissions, chat, presence, or live placement state.

Imports validate references, hashes, binary ranges, nesting, sizes, transforms, and cycles before changing a draft. The server-backed authoring API rejects embedded portable media until it is uploaded through the normal asset flow. Future Git and collaboration layers operate on these files and revisions rather than changing the portable document contract.

## Delivery and acceptance

The first prototype includes two connected areas, draft publication, a door invitation, two players, chat, image tokens and cards, drawn zones, and switching between map and perspective views. Both players must see the same accepted placements, and invited authors must be able to contribute without broader editing rights.

Next add nested inventory, custom attributes, private sessions, safe publication updates, vehicle interiors and travel, and GLB import/export. Introduce public discovery after moderation is ready.

Verify that competing transfers cannot duplicate items, retries cannot repeat actions, reconnects recover current state, private contents never reach unauthorized clients, and failed wagon travel leaves everyone at the source. Image-only areas must remain useful in both graphical views.

Things, character templates, and articles can have descriptive, free-form tags such as character, setting, item, or vehicle. Tags organize content without imposing rules or permissions. The library separates owned articles, shared articles, character editing, live sessions, and connections into top navigation tabs.

Published articles catalog exits as generated links from approved connections. Browsing a destination article does not move a character; live play provides a separate Travel action. Connection state and access permissions determine whether a destination is linked or marked unavailable, while sessions retain their pinned publications.

Unexplored exits are opportunities to author the far side. Owners can create a destination draft or issue a single-use contribution link. Other readers can request permission. An approved contributor owns the new article/space and can create nested Things there, while the original owner retains source editing and explicitly accepts the proposed connection. Creating content never publishes it or changes existing live sessions.

## Current unification phase

The authoring workspace uses one versioned Thing document for characters, places, and nested objects. Nodes have stable identities; parent-child placement records carry relative transforms. Character and space are capabilities that can coexist, separate from descriptive tags. The same full-size workspace opens any Thing, navigates its contents, and autosaves owned/granted drafts. Characters appear as cards, including a large creation card.

Prose, relative child links, and normalized data can be inspected in Article and Document views. Existing area/wiki and character storage adapters remain in place; independent child wiki articles, Git storage, and portable PNG/GLB document packaging are subsequent work. Current sessions retain their existing publication pins and temporary scene copies. Uploads and HTTPS references support independent token art, artwork, backgrounds, and static GLB models; external URLs are not archived.

### Shared drawing

Players can draw together directly on a space in either camera view. The owner opens drawing to session viewers; colored cursors identify active artists. Freehand ink has color, thickness, whole-stroke erasing, and personal undo/redo. Draw mode suspends token manipulation; Select restores it.

Drawings are editable vector strokes on the space's local XY plane, independent of its background image. A 20 km × 20 km drawing canvas extends beyond map edges and also works in spaces with no background. They work inside rooms, characters, and nested containers. Completed ink persists with the session. Only the source owner can save its drawing layer into the authored Thing; publishing remains explicit and other session edits are not captured. Private-space permissions apply to both ink and collaborator presence.

Live navigation uses a compact breadcrumb row for the viewed space. The active character's name in the main header returns the view to their physical location; an adjacent swap control opens owned character cards to change the session's viewing anchor without removing other characters.
