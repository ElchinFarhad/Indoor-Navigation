# Testing with real supermarket data

The third venue, **Carrefour Montesson (real data)**, exists to test the application on something that
was not designed by us: the outline of a real hypermarket and a real product catalogue. Open it with
`/?venue=carrefour` or choose it in the venue selector on the home screen.

## What was looked for, and what exists

| Wanted | Is it public? | What is used instead |
|---|---|---|
| A Carrefour API for products and their aisle | No. Carrefour publishes no developer API for its catalogue; the "Carrefour APIs" on the web are paid scrapers of carrefour.fr, which the site's terms do not allow | **Open Food Facts**: an open product database with a public API. Contributors record where a product is sold, so it can be asked for "products sold at Carrefour in France" |
| A floor plan of a Carrefour store with its aisles | No. Retailers treat the planogram (what stands where) as confidential; no open dataset of supermarket floor plans with product positions was found | **OpenStreetMap**: a few shopping centres are mapped indoors. The Montesson centre near Paris is one: the outline of the Carrefour hypermarket, its entrances and about 50 neighbouring shops are surveyed |
| Which product stands in which aisle | No, anywhere | A plausible assignment, made here (see below) |

So the venue is real where real data exists, and says clearly where it is not.

## What is real

**The map** (OpenStreetMap, [way 221944925](https://www.openstreetmap.org/way/221944925) and its
surroundings):

- the outline of the sales floor: about 231 m long, 9 290 m², with its recesses,
- the two entrances from the mall, at their surveyed positions,
- the mall building and the shops around the store, with their names,
- the store's address.

**The products** (Open Food Facts, `stores_tags=carrefour`, France, most scanned first):

- name as printed on the pack (French), brand, pack size, barcode (EAN) as the product id, photo,
- the category each product belongs to (56 categories, from "Milk" to "Frozen vegetables").

## What is not real

- **The aisles.** Fourteen food aisles, five wide department aisles, three cross aisles, the service
  counters along the back wall and the checkout line are laid out by `scripts/build-carrefour.js` at
  realistic dimensions (3.6 m aisles, 7 m gondola pitch). The script refuses to build if any shelf or
  marker would fall outside the real outline.
- **Which category is in which aisle**, and therefore where a product is.
- **The non-food departments** (clothing, appliances…) are destinations without products: Open Food
  Facts only covers food.
- **The QR markers** (42, at the aisle ends and the entrances) are positions in the data; nothing is
  installed in the real store.
- **Availability and prices.** That a product was once seen at a Carrefour does not mean this store
  stocks it today.

Do not use this venue to navigate the actual store. It is a test bed: real size, real shape, real
product names, at a scale (130 graph points, some 330 products, routes of 300 m) the designed demo
store does not reach.

## How it is built

```
scripts/fetch-carrefour-data.js   downloads the two snapshots (needs network)
scripts/data/carrefour-montesson/ osm.json, off-products.json: the snapshots, committed
scripts/carrefour-sections.js     the 56 shelf sections and their Open Food Facts categories
scripts/build-carrefour.js        snapshots -> src/db/carrefour-montesson.json
```

```bash
cd react-client
node scripts/fetch-carrefour-data.js   # optional: refresh the snapshots
node scripts/build-carrefour.js
```

The build is offline and repeatable: it reads only the committed snapshots. The fetch script waits
between requests because the Open Food Facts search API allows ten a minute; it saves after every
category and can be run again until all of them are complete.

Geometry: OpenStreetMap coordinates are projected to metres, then turned so that the store's long back
wall is horizontal (the real building stands at about 47° to north). The frame is checked for
handedness, so the plan is not mirrored. One map unit is 0.2 m.

New in the data format for this venue:

- `meta.floors[].outlines`: polygons (`site`, `shop`, `corridor`, `store`) drawn under the rooms. The
  `store` outline is also the wall of the 3D view, open where an entrance door meets it.
- `products[].brand`, `.quantity`, `.image`; `meta.featured` (products offered before a search);
  `meta.attribution` (shown on the map) and `meta.address`.

## Using another store

Any store that is mapped indoors in OpenStreetMap can be used the same way: change `BBOX` and
`STORE_WAY` in `fetch-carrefour-data.js`, and the `stores_tags` filter if it is another chain. Stores
with an indoor outline are rare; without one, the building footprint (`building=retail`) can serve as
the outline.

## Licences

- Map data © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/).
- Product data: Open Food Facts, ODbL 1.0; the database contents under the Database Contents License;
  product photos CC BY-SA.

The credit line is shown on the map wherever this venue is displayed. Product photos are loaded from
Open Food Facts when the list is shown; they are not copied into this repository.
