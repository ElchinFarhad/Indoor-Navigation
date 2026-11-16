# Venue data: retailers, stores, versions

A venue is data, not code. The app is built once; which stores exist, what their maps look like and
where each product stands are files that are published next to it and loaded when the app starts.

## Layout of the sources

```
react-client/venues-src/
  <retailer>/
    <store>/
      store.json      who and what: ids, names, version, type, credit line
      map.json        the place: floors, shelf bays with location codes, walkable graph, QR markers
      locations.csv   what stands at each location code          (stores only)
      products.csv    which product is at which location code    (stores only)
```

Three stores ship as examples: `demo/engineering-building` (a building, no CSV files),
`freshmart/demo` (a designed supermarket) and `carrefour/montesson` (real outline and products, see
[REAL-DATA.md](REAL-DATA.md)).

The two halves change at different speeds, which is why they are separate:

| File | Changes when | Who edits it |
|---|---|---|
| `map.json` | Fixtures are physically moved, a marker is added | Whoever surveys the store |
| `locations.csv` | A category moves to other bays | Store or space planning |
| `products.csv` | Assortment or planogram changes, typically weekly | An import from the retailer's systems |

## Location codes

A location code names a physical place and never says what is on the shelf.

- `A03-02`: aisle 3, bay 2. Bays are counted from the back wall, odd numbers on the left of the
  aisle, even on the right.
- `B-01`: counters along the back wall. `D02-01`: department blocks.
- Any scheme works as long as it matches `^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$`. If the retailer already
  has bay or module codes, use theirs.

Because the code is permanent, a promotion or a re-shuffle touches only the CSV files:

- **Move a product:** change its `location` in `products.csv`. One line.
- **Move a category:** swap the `code` of two lines in `locations.csv`, and update the products that
  moved with it.
- **Nothing in the map changes**, so nobody re-surveys anything.

## File formats

`store.json`

```json
{
  "id": "supermarket",
  "name": "FreshMart Supermarket",
  "name_it": "Supermercato FreshMart",
  "retailer": { "id": "freshmart", "name": "FreshMart" },
  "store": { "id": "demo", "name": "Demo store" },
  "type": "store",
  "version": "2026-11-16",
  "featured": ["milk", "bread"]
}
```

`id` is the short name used in links (`?venue=supermarket`). `type` is `store` or `building`.
Optional: `order` (position in the selector), `address`, `attribution`, `featured` (product ids
offered before a search).

`locations.csv`

```csv
code,section,kind,name,name_it
A01-01,fruit,produce,Fruit,Frutta
A06-02,milk,dairy,Milk & yoghurt,Latte e yogurt
```

`code` and `name` are required. `section` is a stable id for the category (it stays the same when the
category moves, so saved shopping lists and links keep working); if omitted it is derived from the
name. `kind` picks the colour and icon.

`products.csv`

```csv
id,name,name_it,brand,quantity,location,image
8001234567890,Whole milk,Latte intero,Centrale,1 l,A06-02,
```

`id` (use the EAN barcode), `name` and `location` are required; the rest is optional. Text may be
quoted, with commas inside quotes. Save as UTF-8.

`map.json` is the graph format described in [ARCHITECTURE.md](ARCHITECTURE.md); a shelf bay is a room
with a `code` and no name. The three example maps are produced by the generator scripts
(`scripts/build-*.js`), which never overwrite the CSV files unless run with `--reseed`.

Other languages: add a suffix. `name_it`, `short_it`, `label_it`, `spoken_it` in JSON, `name_it` as a
CSV column. Missing translations fall back to the base text.

## Publishing

```bash
cd react-client
npm run venues:check   # validate only, print the report
npm run venues         # compile into public/venues/ (also runs before start and build)
```

Output, served as static files:

```
venues/index.json                              the stores and their current version
venues/<retailer>/<store>/<version>/map.json
venues/<retailer>/<store>/<version>/catalog.json
```

The app always re-reads `index.json` and caches the versioned files forever. So:

- **Publish new data:** raise `version` in `store.json`, compile, upload. Phones pick it up on the
  next start; no app rebuild.
- **Roll back:** upload the previous `index.json`. Old version folders can stay on the server.

## Validation

The compiler refuses to publish when a store would break:

- a location code in `locations.csv` that is not on the map, or listed twice,
- a duplicate product id, a missing required field, a malformed code.

It publishes, but reports:

- **products without a usable location** (unknown or empty code). They are left out of the catalogue
  and listed, so a nightly import never sends a customer to a dead end,
- bays on the map with nothing assigned (shown as empty blocks, not offered as destinations).

For a nightly import, treat a growing "left out" list as the alarm.

## Adding a retailer or a store

1. Create `venues-src/<retailer>/<store>/` with a `store.json`.
2. Provide `map.json`: write a generator like `scripts/build-supermarket.js`, or produce it from the
   CAD plan. Give every bay a code.
3. Export `locations.csv` and `products.csv` from the retailer's data (a small converter per source
   system; the app only ever reads these two shapes).
4. `npm run venues:check`, then build.
5. Markers: `node scripts/generate-markers.js --venue <retailer>/<store> --base https://your.domain`.

There is no admin interface yet: these are files in a repository, which is enough for a first store
and keeps every change reviewable. An admin panel becomes worth building with the second or third
store.
