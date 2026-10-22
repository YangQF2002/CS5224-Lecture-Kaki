# LectureKaki frontend

React, TypeScript, Vite, and React Router.

For a production build served by Nginx in Docker, see
[Docker setup](../docs/docker.md). The commands below run the Vite development
server with hot reload.

Run these commands from `frontend/` using Node.js 24 LTS:

```sh
npm ci
npm run dev
```

Open <http://localhost:5173>.

Checks: `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` (which also checks types). Run `npm run format` to apply Prettier formatting.

## Timetable

Choose an academic year (`YYYY-YYYY`) and semester, then search for modules and select lesson groups or import a NUSMods student timetable share link.

Selections are saved in this browser when local storage is available. Changing year or semester clears the current selections. Possible timetable conflicts are highlighted.
