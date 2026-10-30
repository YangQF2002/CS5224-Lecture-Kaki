# LectureKaki frontend

React, TypeScript, Vite, and React Router.

For a production build served by Nginx in Docker, see
[Docker setup](../docs/docker.md). The commands below run the Vite development
server with hot reload.

Run these commands from `frontend/` using Node.js 24 LTS (minimum 24.22.1):

```sh
npm ci
npm run dev
```

Open <http://localhost:5173>.

Checks: `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` (which also checks types). Run `npm run format` to apply Prettier formatting.

## Discover

The home page lists lectures from the published snapshot at `/lectures/` and filters them in the browser by week, day, time, building, subject code, faculty, level, class size and keywords. Filters are stored in the URL, so a filtered view can be shared. See [lecture discovery](../docs/lecture-discovery.md).

The dev server proxies `/lectures` to `http://localhost:8001`, where you can serve locally generated data (see [lecture data](../docs/lecture-data.md#local-development)). To use deployed data instead:

```sh
LECTURES_ORIGIN=https://<WebsiteURL> npm run dev
```

## Timetable

The timetable is at `/timetable`.

Choose an academic year (`YYYY-YYYY`). To build a timetable manually, select a semester, search for modules and choose lesson groups.

To import a timetable, paste a NUSMods student timetable share link. The link supplies the semester, and importing replaces any existing timetable after confirmation.

Selections are saved in this browser when local storage is available. Changing year or semester clears the current selections. Possible timetable conflicts are highlighted.

Module search and timetable loading require access to the public NUSMods API.

## Forum

Open `/forum` with a shared room ID, or select **Join discussion** on a Discover
lecture card. Cognito login uses `/auth/callback`; signed-in users can post,
receive live updates and delete their own messages.

Configure the public API and Cognito values in `frontend/.env.local`; see
[Forum setup](../docs/forum.md) for local configuration, Docker login and testing.
