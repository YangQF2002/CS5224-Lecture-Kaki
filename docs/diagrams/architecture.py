"""Architecture figure for the report and slides.

Components and flows follow infra/ (Terraform and the older CloudFormation stacks). Update this file when either changes.

Every position is fixed by hand so the figure keeps the brief's layout (students
on the left, data on the right, ingest along the bottom); automatic layout
(Graphviz) kept moving groups and routing arrows across the figure. Icons are
the official AWS icons shipped with the `diagrams` package.

Besides the overall figure, PARTS draws five smaller figures, one per area, with
the same icons, colours and line styles, so each can be read on its own.

Render (needs rsvg-convert, installed with `brew install librsvg` or Graphviz):

    pip install diagrams
    python docs/diagrams/architecture.py   # writes architecture*.svg and .png here
"""

import base64
import subprocess
from html import escape
from importlib import resources
from pathlib import Path

HERE = Path(__file__).parent
ICONS = resources.files("resources")  # Installed by the `diagrams` package.

WIDTH, HEIGHT = 1600, 1210
ICON = 64  # Icon size in pixels; nodes below are icon centres.
FONT = "Helvetica, Arial, sans-serif"

# Three colours, each with its own line style so the figure reads in greyscale.
REQUEST = {"color": "#1f4e79", "dash": ""}
AUTH = {"color": "#2e7d32", "dash": "2 5"}
INGEST = {"color": "#b34700", "dash": "9 6"}
MONITOR = {"color": "#6b4c9a", "dash": "4 3 1 3"}

# name: (icon file, x, y, service, role)
NODES = {
    "students": ("onprem/client/users.png", 100, 430, "Students", "Web browser"),
    "cdn": ("aws/network/cloudfront.png", 440, 190, "CloudFront", "Serves app and lectures"),
    "web": ("aws/storage/simple-storage-service-s3-bucket.png", 740, 190, "S3 web bucket", "App and lecture snapshots"),
    "cognito": ("aws/security/cognito.png", 440, 350, "Cognito", "App sign-in; NUS email required"),
    "pre_signup": ("aws/compute/lambda.png", 740, 350, "Lambda: pre sign-up", "Allows @u.nus.edu only"),
    "ws_api": ("aws/network/api-gateway.png", 440, 510, "API Gateway: WebSocket", "Holds live sockets"),
    "live": ("aws/compute/lambda.png", 620, 510, "Lambda: forum live", "Connect, ready, disconnect, ping"),
    "http_api": ("aws/network/api-gateway.png", 440, 650, "API Gateway: HTTP API", "Every REST request"),
    "api": ("aws/compute/lambda.png", 620, 650, "Lambda: FastAPI", "REST; queues live events"),
    "fanout": ("aws/compute/lambda.png", 1060, 555, "Lambda: forum fan-out", "Async delivery and retries"),
    "tables": ("aws/database/dynamodb.png", 800, 510, "DynamoDB: 3 tables", "Forum, timetables, profiles"),
    "pdfs": ("aws/storage/simple-storage-service-s3-bucket.png", 800, 650, "S3 forum PDFs", "Private, signed links only"),
    "schedule": ("aws/integration/eventbridge-scheduler.png", 440, 960, "EventBridge Scheduler", "Weekly, on Mondays"),
    "ingest": ("aws/compute/lambda.png", 740, 860, "Lambda: ingest", "Builds lecture snapshots"),
    "cleanup": ("aws/compute/lambda.png", 740, 1075, "Lambda: PDF cleanup", "Deletes closed rooms' PDFs"),
    "bedrock": ("aws/ml/bedrock.png", 1010, 860, "Bedrock", "Tags module topics"),
    "alarm": ("aws/management/cloudwatch-alarm.png", 1110, 1075, "CloudWatch alarms", "Ingestion and API errors"),
    "alerts": ("aws/integration/simple-notification-service-sns.png", 1270, 1075, "SNS", "Emails the team"),
    "nusmods": ("onprem/network/internet.png", 1480, 725, "NUSMods API", "Modules and lessons"),
}

# (x, y, width, height, title); the first is the AWS boundary.
GROUPS = [
    (330, 110, 1010, 1060, "AWS Cloud (ap-southeast-1)"),
    (350, 135, 520, 130, "Static site"),
    (350, 290, 520, 135, "Sign-in"),
    (350, 450, 970, 290, "API and data"),
    (350, 770, 970, 385, "Scheduled jobs and alerts"),
]

# (kind, points, label, label x, label y, label anchor, double-headed)
EDGES = [
    # 1. App and lecture snapshots, no login.
    (REQUEST, [(132, 404), (205, 404), (205, 190), (404, 190)], "HTTPS", 300, 182, "middle", False),
    (REQUEST, [(476, 190), (704, 190)], "OAC", 590, 182, "middle", False),
    (REQUEST, [(100, 394), (100, 70), (1480, 70), (1480, 689)], "module list", 800, 62, "middle", False),
    # 2. Sign-in; the API verifies tokens with Cognito's public keys.
    (AUTH, [(132, 418), (245, 418), (245, 350), (404, 350)], "hosted sign-in", 326, 342, "middle", False),
    (AUTH, [(476, 350), (704, 350)], "on sign-up", 590, 342, "middle", False),
    (AUTH, [(640, 618), (640, 592), (680, 592), (680, 372), (476, 372)], "signing keys", 688, 470, "start", False),
    # 3-4. REST through the HTTP API; live updates through the WebSocket API, which holds the sockets.
    (REQUEST, [(132, 446), (225, 446), (225, 510), (408, 510)], "WSS", 309, 502, "middle", True),
    (REQUEST, [(132, 460), (210, 460), (210, 650), (408, 650)], "HTTPS", 309, 642, "middle", False),
    (REQUEST, [(472, 510), (588, 510)], "$connect", 530, 502, "middle", False),
    (REQUEST, [(652, 510), (768, 510)], "", 0, 0, "middle", True),
    (REQUEST, [(472, 650), (588, 650)], "invokes", 530, 642, "middle", False),
    (REQUEST, [(652, 685), (960, 685), (960, 555), (1024, 555)], "async invoke", 950, 610, "end", False),
    (REQUEST, [(1024, 555), (920, 555), (920, 510), (836, 510)], "", 0, 0, "middle", True),
    (REQUEST, [(1060, 519), (1060, 460), (476, 460), (476, 478)], "fan-out", 1000, 452, "middle", False),
    (REQUEST, [(652, 640), (768, 524)], "", 0, 0, "middle", True),
    (REQUEST, [(652, 655), (768, 655)], "signed URLs\nvalidate / delete", 710, 631, "middle", True),
    (REQUEST, [(1096, 555), (1270, 555), (1270, 1039)], "failed delivery", 1262, 690, "end", False),
    (REQUEST, [(132, 432), (903, 432), (903, 642), (832, 642)], "PDF upload / download", 820, 444, "middle", False),
    (REQUEST, [(652, 668), (695, 668), (695, 725), (1444, 725)], "checks timetables", 1150, 717, "middle", False),
    # 5. Weekly jobs: lecture ingest (Mondays 03:00 SGT) and PDF cleanup (00:05).
    (INGEST, [(476, 950), (580, 950), (580, 860), (704, 860)], "Mon 03:00", 642, 852, "middle", False),
    (INGEST, [(476, 970), (580, 970), (580, 1075), (704, 1075)], "Mon 00:05", 642, 1067, "middle", False),
    (INGEST, [(776, 848), (920, 848), (920, 190), (776, 190)], "snapshot, then\ncurrent.json", 928, 300, "start", False),
    (INGEST, [(776, 866), (974, 866)], "topics", 945, 858, "middle", False),
    (INGEST, [(740, 826), (740, 745), (1444, 745)], "fetch", 1150, 762, "middle", False),
    (INGEST, [(776, 1063), (880, 1063), (880, 676), (836, 676)], "deletes closed\nrooms' PDFs", 888, 1000, "start", False),
    # 6. Error metrics: every Lambda's errors, the HTTP API's 5xx and log-based alarms.
    (MONITOR, [(1140, 740), (1140, 1039)], "API Lambdas: errors,\n5xx and crash logs", 1148, 800, "start", False),
    (MONITOR, [(776, 878), (850, 878), (850, 1050), (1074, 1050)], "", 0, 0, "middle", False),
    (MONITOR, [(776, 1087), (1074, 1087)], "errors", 1010, 1079, "middle", False),
    (MONITOR, [(1146, 1075), (1234, 1075)], "", 0, 0, "middle", False),
]

LEGEND = [
    ("User / API requests", REQUEST, False),
    ("Sign-in and token checks", AUTH, False),
    ("Weekly jobs", INGEST, False),
    ("Error metrics and alerts", MONITOR, False),
    ("Reads and writes", REQUEST, True),
]


def icon(path: str) -> str:
    data = base64.b64encode(ICONS.joinpath(path).read_bytes()).decode()
    return f"data:image/png;base64,{data}"


def text(x, y, content, size=12, weight="normal", anchor="middle", color="#1f2933", halo=False):
    halo_attrs = ' stroke="white" stroke-width="5" stroke-linejoin="round" paint-order="stroke"' if halo else ""
    lines = content.split("\n")
    spans = "".join(
        f'<tspan x="{x}" dy="{0 if i == 0 else size + 2}">{escape(line)}</tspan>'
        for i, line in enumerate(lines)
    )
    return (
        f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
        f'text-anchor="{anchor}" fill="{color}"{halo_attrs}>{spans}</text>'
    )


def marker_id(kind) -> str:
    return "arrow-" + kind["color"].lstrip("#")


def line(points, kind, double=False):
    path = " ".join(f"{x},{y}" for x, y in points)
    dash = f' stroke-dasharray="{kind["dash"]}"' if kind["dash"] else ""
    cap = ' stroke-linecap="round"' if kind["color"] == AUTH["color"] else ""
    start = f' marker-start="url(#{marker_id(kind)}-start)"' if double else ""
    end = f' marker-end="url(#{marker_id(kind)})"' if kind.get("arrow", True) else ""
    return (
        f'<polyline points="{path}" fill="none" stroke="{kind["color"]}" stroke-width="2"'
        f'{dash}{cap}{start}{end}/>'
    )


def markers() -> str:
    out = []
    for kind in (REQUEST, AUTH, INGEST, MONITOR):
        mid = marker_id(kind)
        for suffix, orient in (("", "auto"), ("-start", "auto-start-reverse")):
            out.append(
                f'<marker id="{mid}{suffix}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" '
                f'markerHeight="11" markerUnits="userSpaceOnUse" orient="{orient}"><path d="M0,0 L10,5 L0,10 z" fill="{kind["color"]}"/></marker>'
            )
    return "".join(out)


def build(spec: dict) -> str:
    width, height = spec["size"]
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        f"<defs>{markers()}</defs>",
        f'<rect width="{width}" height="{height}" fill="white"/>',
        text(width / 2, 36, spec["title"], size=22, weight="bold"),
    ]

    for i, (x, y, w, h, title) in enumerate(spec["groups"]):
        fill, stroke = ("#f5f7fa", "#8a96a3") if i == 0 else ("#edf3ea", "#a9b8a3")
        parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
        parts.append(text(x + 12, y + 20, title, size=13 if i else 14, weight="bold", anchor="start"))

    for kind, points, *_rest, double in spec["edges"]:
        parts.append(line(points, kind, double))

    for path, x, y, service, role in spec["nodes"].values():
        half = ICON / 2
        parts.append(f'<image href="{icon(path)}" x="{x - half}" y="{y - half}" width="{ICON}" height="{ICON}"/>')
        parts.append(text(x, y + half + 16, service, size=13, weight="bold", halo=True))
        parts.append(text(x, y + half + 31, role, size=11.5, color="#3e4c59", halo=True))

    # Edge labels last, so they sit on top of any line they cross.
    for kind, _points, label, lx, ly, anchor, _double in spec["edges"]:
        if label:
            parts.append(text(lx, ly, label, size=12, anchor=anchor, color=kind["color"], halo=True))

    legend = spec["legend"]
    lx, ly = spec["legend_at"]
    lw = spec.get("legend_width", 290)
    parts.append(f'<rect x="{lx}" y="{ly}" width="{lw}" height="{50 + 34 * len(legend)}" rx="10" fill="white" stroke="#8a96a3" stroke-width="1.5"/>')
    parts.append(text(lx + 14, ly + 24, "Legend", size=14, weight="bold", anchor="start"))
    for i, (name, kind, double) in enumerate(legend):
        y = ly + 60 + i * 34
        parts.append(line([(lx + 16, y), (lx + 86, y)], kind, double))
        parts.append(text(lx + 100, y + 4, name, size=13, anchor="start"))

    parts.append("</svg>")
    return "\n".join(parts)


OVERALL = {
    "title": "LectureKaki architecture (November 2026)",
    "size": (WIDTH, HEIGHT),
    "nodes": NODES,
    "groups": GROUPS,
    "edges": EDGES,
    "legend": LEGEND,
    "legend_at": (20, 950),
}


def at(name: str, x: int, y: int, role: str | None = None):
    """A node from the overall figure, placed for a part figure."""
    path, _x, _y, service, overall_role = NODES[name]
    return (path, x, y, service, role or overall_role)


BUS = dict(MONITOR, arrow=False)  # Lines that join a shared trunk.
READS = ("Reads and writes", REQUEST, True)
REQUESTS = ("User / API requests", REQUEST, False)

PARTS = {
    "1-site-and-sign-in": {
        "title": "1. Static site and sign-in",
        "size": (960, 780),
        "nodes": {
            "students": at("students", 100, 300),
            "cdn": at("cdn", 440, 145),
            "web": at("web", 760, 145),
            "cognito": at("cognito", 440, 335),
            "pre_signup": at("pre_signup", 760, 335),
            "api": at("api", 440, 520, "Verifies each request's token"),
        },
        "groups": [
            (300, 60, 640, 560, "AWS Cloud (ap-southeast-1)"),
            (320, 85, 600, 150, "Static site"),
            (320, 270, 600, 150, "Sign-in"),
            (320, 455, 600, 150, "API"),
        ],
        "edges": [
            (REQUEST, [(132, 285), (220, 285), (220, 145), (404, 145)], "HTTPS", 312, 137, "middle", False),
            (REQUEST, [(476, 145), (724, 145)], "OAC", 600, 137, "middle", False),
            (AUTH, [(132, 300), (240, 300), (240, 335), (404, 335)], "hosted sign-in", 322, 327, "middle", False),
            (AUTH, [(476, 325), (724, 325)], "on sign-up", 600, 317, "middle", False),
            (REQUEST, [(132, 315), (200, 315), (200, 520), (404, 520)], "API requests\nwith token", 302, 498, "middle", False),
            (AUTH, [(476, 520), (600, 520), (600, 350), (476, 350)], "signing keys", 608, 440, "start", False),
        ],
        "legend": [REQUESTS, ("Sign-in and token checks", AUTH, False)],
        "legend_at": (300, 640),
        "legend_width": 270,
    },
    "2-rest-api-and-storage": {
        "title": "2. REST API and storage",
        "size": (1240, 560),
        "nodes": {
            "students": at("students", 100, 270),
            "http_api": at("http_api", 420, 170),
            "api": at("api", 640, 170, "Timetables, profiles, Forum"),
            "tables": at("tables", 880, 170),
            "pdfs": at("pdfs", 880, 380),
            "nusmods": at("nusmods", 1130, 270),
        },
        "groups": [(300, 90, 720, 440, "AWS Cloud (ap-southeast-1)")],
        "edges": [
            (REQUEST, [(132, 255), (220, 255), (220, 170), (384, 170)], "HTTPS", 302, 162, "middle", False),
            (REQUEST, [(456, 170), (604, 170)], "invokes", 530, 162, "middle", False),
            (REQUEST, [(676, 160), (844, 160)], "", 0, 0, "middle", True),
            (REQUEST, [(676, 182), (760, 182), (760, 365), (844, 365)], "signed URLs;\nvalidate / delete PDFs", 768, 280, "start", True),
            (REQUEST, [(132, 285), (240, 285), (240, 395), (844, 395)], "PDF upload / download (signed URL)", 540, 387, "middle", False),
            (REQUEST, [(640, 138), (640, 115), (1130, 115), (1130, 234)], "checks timetables", 900, 107, "middle", False),
            (REQUEST, [(100, 238), (100, 72), (1160, 72), (1160, 234)], "module list (from the browser)", 640, 64, "middle", False),
        ],
        "legend": [REQUESTS, READS],
        "legend_at": (20, 400),
        "legend_width": 250,
    },
    "3-live-forum-updates": {
        "title": "3. Live Forum updates",
        "size": (1140, 570),
        "nodes": {
            "students": at("students", 100, 290),
            "ws_api": at("ws_api", 420, 170),
            "live": at("live", 640, 170),
            "tables": at("tables", 880, 170, "Messages and connections"),
            "http_api": at("http_api", 420, 420),
            "api": at("api", 640, 420, "Saves, then queues the event"),
            "fanout": at("fanout", 880, 420),
        },
        "groups": [(300, 70, 820, 480, "AWS Cloud (ap-southeast-1)")],
        "edges": [
            (REQUEST, [(132, 275), (220, 275), (220, 170), (384, 170)], "WSS (live socket)", 302, 162, "middle", True),
            (REQUEST, [(456, 170), (604, 170)], "connect, ready", 530, 162, "middle", False),
            (REQUEST, [(676, 170), (844, 170)], "connections", 760, 162, "middle", True),
            (REQUEST, [(132, 305), (220, 305), (220, 420), (384, 420)], "post message", 302, 412, "middle", False),
            (REQUEST, [(456, 420), (604, 420)], "invokes", 530, 412, "middle", False),
            (REQUEST, [(676, 405), (760, 405), (760, 190), (844, 190)], "saves", 768, 300, "start", False),
            (REQUEST, [(676, 435), (844, 435)], "async invoke", 760, 427, "middle", False),
            (REQUEST, [(900, 388), (900, 240)], "room's\nconnections", 908, 320, "start", True),
            (REQUEST, [(916, 420), (1040, 420), (1040, 100), (420, 100), (420, 138)], "sends the event to each connection", 730, 92, "middle", False),
        ],
        "legend": [REQUESTS, READS],
        "legend_at": (20, 430),
        "legend_width": 250,
    },
    "4-weekly-jobs": {
        "title": "4. Weekly jobs",
        "size": (1300, 560),
        "nodes": {
            "schedule": at("schedule", 160, 300, "Mondays, Singapore time"),
            "ingest": at("ingest", 470, 170),
            "cleanup": at("cleanup", 470, 420),
            "web": at("web", 790, 160),
            "bedrock": at("bedrock", 790, 300),
            "pdfs": at("pdfs", 790, 420),
            "nusmods": at("nusmods", 1150, 170),
        },
        "groups": [(40, 70, 940, 470, "AWS Cloud (ap-southeast-1)")],
        "edges": [
            (INGEST, [(196, 290), (310, 290), (310, 170), (434, 170)], "03:00", 372, 162, "middle", False),
            (INGEST, [(196, 310), (310, 310), (310, 420), (434, 420)], "00:05", 372, 412, "middle", False),
            (INGEST, [(470, 138), (470, 100), (1150, 100), (1150, 134)], "fetch modules and venues", 900, 92, "middle", False),
            (INGEST, [(506, 160), (754, 160)], "snapshot, then current.json", 630, 152, "middle", False),
            (INGEST, [(506, 182), (620, 182), (620, 300), (754, 300)], "topics", 628, 250, "start", False),
            (INGEST, [(506, 420), (754, 420)], "deletes closed rooms'\nPDFs (every version)", 630, 398, "middle", False),
        ],
        "legend": [("Weekly jobs", INGEST, False)],
        "legend_at": (1010, 330),
        "legend_width": 250,
    },
    "5-monitoring-and-alerts": {
        "title": "5. Monitoring and alerts",
        "size": (1240, 900),
        "nodes": {
            "http_api": at("http_api", 220, 140),
            "api": at("api", 220, 260),
            "live": at("live", 220, 380),
            "ingest": at("ingest", 220, 500),
            "cleanup": at("cleanup", 220, 620),
            "fanout": at("fanout", 220, 740),
            "alarm": at("alarm", 700, 440, "9 alarms, 5-minute windows"),
            "alerts": at("alerts", 960, 440),
            "team": ("onprem/client/users.png", 1150, 440, "Team", "Confirmed email subscribers"),
        },
        "groups": [(40, 60, 1000, 820, "AWS Cloud (ap-southeast-1)")],
        "edges": [
            (BUS, [(256, 140), (520, 140), (520, 730)], "5xx (5+)", 300, 132, "start", False),
            (BUS, [(256, 260), (520, 260)], "errors (5+), crash logs (1+)", 300, 252, "start", False),
            (BUS, [(256, 380), (520, 380)], "errors (5+)", 300, 372, "start", False),
            (BUS, [(256, 500), (520, 500)], "errors (1+), small new semester (1+)", 300, 492, "start", False),
            (BUS, [(256, 620), (520, 620)], "errors (1+)", 300, 612, "start", False),
            (BUS, [(256, 730), (520, 730)], "errors (5+), enqueue failures (1+)", 300, 722, "start", False),
            (MONITOR, [(520, 440), (664, 440)], "metrics", 592, 432, "middle", False),
            (MONITOR, [(736, 440), (924, 440)], "alarm", 830, 432, "middle", False),
            (MONITOR, [(996, 440), (1114, 440)], "email", 1055, 432, "middle", False),
            (REQUEST, [(256, 752), (300, 752), (300, 840), (960, 840), (960, 515)], "events that still fail after 2 retries", 630, 832, "middle", False),
        ],
        "legend": [("Error metrics and alerts", MONITOR, False), ("Failed live deliveries", REQUEST, False)],
        "legend_at": (600, 120),
        "legend_width": 300,
    },
}


def render(name: str, spec: dict) -> None:
    svg = HERE / f"{name}.svg"
    svg.write_text(build(spec))
    # 2x for print.
    subprocess.run(
        ["rsvg-convert", "--zoom=2", "--format=png", "--output", str(HERE / f"{name}.png"), str(svg)],
        check=True,
    )
    print(f"Wrote {name}.svg and {name}.png")


if __name__ == "__main__":
    render("architecture", OVERALL)
    for part, spec in PARTS.items():
        render(f"architecture-{part}", spec)
