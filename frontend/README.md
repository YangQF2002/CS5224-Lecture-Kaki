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

## Timetable

Choose an academic year (`YYYY-YYYY`). To build a timetable manually, select a semester, search for modules and choose lesson groups.

To import a timetable, paste a NUSMods student timetable share link. The link supplies the semester, and importing replaces any existing timetable after confirmation.

Selections are saved in this browser when local storage is available. Changing year or semester clears the current selections. Possible timetable conflicts are highlighted.

Module search and timetable loading require access to the public NUSMods API.
