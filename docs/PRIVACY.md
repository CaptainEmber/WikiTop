# Live play privacy

WikiTop Play uses guest names and secret room links rather than accounts. Anyone who receives an active invitation link can join its room until it expires, so invitations should be treated like temporary passwords.

The room service temporarily stores participant names, character summaries, token positions, party location, drawing strokes, host roles, hashed credentials, and command identifiers. It deletes the room one hour after everyone disconnects. It does not write live state to GitHub or Thing GLBs.

Character drafts and embedded media remain in their owner's IndexedDB. During play, every Thing reachable from the selected character is considered shared with all room participants. Requested local GLBs are relayed through the Worker in verified chunks but are not written to Durable Object storage. Other participants can retain anything their browser has received, so live rooms should not contain secret inventory or private artwork.

Published Things are fetched from the public Git repository at the commit pinned when the room was created. Exporting or publishing a character remains a deliberate user action.
