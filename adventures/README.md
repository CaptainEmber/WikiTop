# Private adventure workspace

Each imported adventure uses `adventures/<slug>/source`, `manifest`, and `generated` directories. Those directories are ignored because source books, maps, and generated play packs may contain material that is licensed for private use but not redistribution.

Run `npm run generate:adventure -- <slug>` after placing the required source files. Import all generated GLBs together from **My Things → Open GLB collection**. The importer stores every Thing in IndexedDB and opens the Thing tagged `adventure` as the collection root.
