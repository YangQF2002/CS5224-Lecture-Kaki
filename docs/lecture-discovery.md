# Lecture discovery

Help students find lectures outside their own modules that they can drop in on, filtered by time, place, subject and interest. Later phases suggest lectures that fit a student's free time.

## Data

Discovery reads the static snapshot described in [lecture data](lecture-data.md), served by CloudFront from the same origin as the app. AY2026/27 Semester 1 has 24,858 lecture sessions (up to 455 a day) across 1,479 modules.

| Field                          | Values                                       | Used for                          |
| ------------------------------ | -------------------------------------------- | --------------------------------- |
| `date`, `startTime`, `endTime` | Start times 08:00–19:30                      | When                              |
| `building`                     | 69 buildings; about 6% of sessions have none | Where                             |
| `online`                       | 616 sessions                                 | Hidden by default                 |
| `moduleCode`                   | 158 code prefixes                            | Subject                           |
| `faculty`, `level`             | 19 faculties, levels 1000–6000               | Subject                           |
| `size`                         | Class capacity                               | Larger classes are easier to join |
| `modules.json` `description`   | About 600 characters each                    | Keyword and topic matching        |

## Approach

Filtering runs in the browser, so no API is needed until a feature requires a runtime model or per-user data. Filters are kept in the URL query string, so searches can be bookmarked and shared.

The browser fetches lecture data from `/lectures/` on the app's own CloudFront origin. CloudFront serves cached copies and reads the private S3 bucket through OAC only on a cache miss; the browser never reads S3 directly.

| Request                     | Transferred (Brotli) | Caching                                     |
| --------------------------- | -------------------- | ------------------------------------------- |
| `current.json`              | Under 1 KB           | `no-cache`, so new snapshots appear at once |
| `<snapshot>/index.json`     | 0.5 KB               | 1 day, immutable                            |
| `<snapshot>/modules.json`   | 290 KB               | 1 day, immutable                            |
| `<snapshot>/weeks/<w>.json` | About 65 KB per week | 1 day, immutable                            |

A first visit transfers about 360 KB of data; each further week adds one week file. Deploy the frontend with [personal AWS setup](aws-dev-setup.md#6-deploy-the-frontend); lecture data is published separately by ingestion. For local development, see the [frontend README](../frontend/README.md#discover).

## Phases

| Phase | Scope                                                                       | Depends on                            | Status   |
| ----- | --------------------------------------------------------------------------- | ------------------------------------- | -------- |
| P1    | Discover page with time, building, subject, level, size and keyword filters | Static lecture data                   | Implemented |
| P2    | Topic tags added to `modules.json` by ingestion; interest picker            | Bedrock access, or keyword rules      | Planned  |
| P3    | Suggestions that fit free slots in the saved timetable                      | Building coordinates for walking time | Planned  |
| P4    | Login features: synced preferences, saved lectures, companions              | EC2 API, DynamoDB, frontend login     | Planned  |

### P1 filters

| Filter        | Query parameter | Behaviour                                                                                 |
| ------------- | --------------- | ----------------------------------------------------------------------------------------- |
| Week          | `week`          | Defaults to the week containing today in Singapore time, else the next week with lectures |
| Days          | `days`          | Dates in the selected week; empty means all days                                          |
| Time range    | `from`, `to`    | Lectures that start and end within the range                                              |
| Buildings     | `buildings`     | Building codes; `other` selects in-person venues without a building                       |
| Subject codes | `codes`         | Module code prefixes such as `CS` or `ACC`                                                |
| Faculties     | `faculties`     | Faculty names                                                                             |
| Levels        | `levels`        | Module levels such as `1000`                                                              |
| Minimum size  | `minSize`       | Class capacity                                                                            |
| Keywords      | `q`             | Every word must appear in the module code, title or description                           |
| Online        | `online=1`      | Includes online lectures                                                                  |

"Starting soon" selects today and the next three hours.

### P2 topic tags

Define about 30 topics (for example AI, finance, sustainability, psychology). Ingestion tags each module with matching topics, using embeddings or an LLM on Bedrock, and adds `topics: string[]` to `modules.json`. Only modules whose descriptions changed are re-tagged. A full run covers about 200k tokens. Users choose topics, and the browser filters by tag without running a model.

Free-text semantic search ("lectures about climate policy") needs a query embedding at request time, so it belongs behind the API.

### P3 timetable suggestions

1. Treat every saved lesson in the selected week, including tutorials and labs, as busy.
2. Find free gaps within a day window chosen by the user.
3. Suggest lectures that fit a gap with a walking buffer.
4. Rank by topic match, fit and distance from the previous class.

## Open questions

- Not every lecturer welcomes visitors. Should the app show attendance guidelines or support opt-outs?
- Should venue mapping cover the sessions that have no building?
- Who defines the topic list?
- Is Bedrock available in the project account?
- Should students be able to browse next semester before `current.json` switches?
