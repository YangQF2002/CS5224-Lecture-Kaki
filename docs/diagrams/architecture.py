"""Architecture figure for the report and slides.

Components and flows follow infra/ (Terraform and the older CloudFormation stacks). Update this file when either changes.

Every position is fixed by hand so the figure keeps the brief's layout (students
on the left, data on the right, ingest along the bottom); automatic layout
(Graphviz) kept moving groups and routing arrows across the figure. Icons are
the official AWS icons shipped with the `diagrams` package.

Render (needs rsvg-convert, installed with `brew install librsvg` or Graphviz):

    pip install diagrams
    python docs/diagrams/architecture.py   # writes architecture.svg and .png here
"""

import base64
import subprocess
from html import escape
from importlib import resources
from pathlib import Path

HERE = Path(__file__).parent
ICONS = resources.files("resources")  # Installed by the `diagrams` package.

WIDTH, HEIGHT = 1600, 1090
ICON = 64  # Icon size in pixels; nodes below are icon centres.
FONT = "Helvetica, Arial, sans-serif"

# Three colours, each with its own line style so the figure reads in greyscale.
REQUEST = {"color": "#1f4e79", "dash": ""}
AUTH = {"color": "#2e7d32", "dash": "2 5"}
INGEST = {"color": "#b34700", "dash": "9 6"}

# name: (icon file, x, y, service, role)
NODES = {
    "students": ("onprem/client/users.png", 100, 430, "Students", "Web browser"),
    "cdn": ("aws/network/cloudfront.png", 440, 190, "CloudFront", "Serves app and lectures"),
    "web": ("aws/storage/simple-storage-service-s3-bucket.png", 740, 190, "S3 web bucket", "App and lecture snapshots"),
    "cognito": ("aws/security/cognito.png", 440, 350, "Cognito", "NUS sign-in, issues tokens"),
    "pre_signup": ("aws/compute/lambda.png", 740, 350, "Lambda: pre sign-up", "Allows @u.nus.edu only"),
    "ws_api": ("aws/network/api-gateway.png", 440, 510, "API Gateway: WebSocket", "Holds live sockets"),
    "live": ("aws/compute/lambda.png", 620, 510, "Lambda: forum live", "Connect, disconnect, ping"),
    "http_api": ("aws/network/api-gateway.png", 440, 650, "API Gateway: HTTP API", "Every REST request"),
    "api": ("aws/compute/lambda.png", 620, 650, "Lambda: FastAPI", "REST and live fan-out"),
    "tables": ("aws/database/dynamodb.png", 800, 510, "DynamoDB: 3 tables", "Forum, timetables, profiles"),
    "pdfs": ("aws/storage/simple-storage-service-s3-bucket.png", 800, 650, "S3 forum PDFs", "Private, signed links only"),
    "schedule": ("aws/integration/eventbridge-scheduler.png", 440, 880, "EventBridge Scheduler", "Mondays 03:00 SGT"),
    "ingest": ("aws/compute/lambda.png", 740, 880, "Lambda: ingest", "Builds lecture snapshots"),
    "bedrock": ("aws/ml/bedrock.png", 1060, 830, "Bedrock", "Tags module topics"),
    "alarm": ("aws/management/cloudwatch-alarm.png", 1060, 960, "CloudWatch alarm", "On ingest errors"),
    "alerts": ("aws/integration/simple-notification-service-sns.png", 1260, 960, "SNS", "Emails the team"),
    "nusmods": ("onprem/network/internet.png", 1480, 725, "NUSMods API", "Modules and lessons"),
}

# (x, y, width, height, title); the first is the AWS boundary.
GROUPS = [
    (330, 110, 1010, 935, "AWS Cloud (ap-southeast-1)"),
    (350, 135, 520, 130, "Static site"),
    (350, 290, 520, 135, "Sign-in"),
    (350, 450, 540, 290, "API and data"),
    (350, 770, 970, 260, "Scheduled ingest"),
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
    (REQUEST, [(598, 622), (472, 528)], "fan-out", 520, 604, "middle", False),
    (REQUEST, [(652, 640), (768, 524)], "", 0, 0, "middle", True),
    (REQUEST, [(652, 655), (768, 655)], "signs links", 710, 647, "middle", False),
    (REQUEST, [(132, 432), (903, 432), (903, 642), (832, 642)], "PDF upload / download", 820, 444, "middle", False),
    (REQUEST, [(652, 668), (695, 668), (695, 725), (1444, 725)], "checks timetables", 1150, 717, "middle", False),
    # 5-6. Weekly ingest and its error alerting.
    (INGEST, [(476, 880), (704, 880)], "weekly", 590, 872, "middle", False),
    (INGEST, [(776, 868), (920, 868), (920, 190), (776, 190)], "snapshot, then\ncurrent.json", 928, 300, "start", False),
    (INGEST, [(776, 884), (960, 884), (960, 830), (1024, 830)], "topics", 990, 822, "middle", False),
    (INGEST, [(776, 898), (960, 898), (960, 960), (1024, 960)], "errors metric", 990, 952, "middle", False),
    (INGEST, [(740, 846), (740, 745), (1444, 745)], "fetch", 1150, 762, "middle", False),
    (INGEST, [(1096, 960), (1224, 960)], "", 0, 0, "middle", False),
]

LEGEND = [
    ("User requests", REQUEST, False),
    ("Sign-in and token checks", AUTH, False),
    ("Weekly lecture ingest", INGEST, False),
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
    cap = ' stroke-linecap="round"' if kind is AUTH else ""
    start = f' marker-start="url(#{marker_id(kind)}-start)"' if double else ""
    return (
        f'<polyline points="{path}" fill="none" stroke="{kind["color"]}" stroke-width="2"'
        f'{dash}{cap}{start} marker-end="url(#{marker_id(kind)})"/>'
    )


def markers() -> str:
    out = []
    for kind in (REQUEST, AUTH, INGEST):
        mid = marker_id(kind)
        for suffix, orient in (("", "auto"), ("-start", "auto-start-reverse")):
            out.append(
                f'<marker id="{mid}{suffix}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" '
                f'markerHeight="11" markerUnits="userSpaceOnUse" orient="{orient}"><path d="M0,0 L10,5 L0,10 z" fill="{kind["color"]}"/></marker>'
            )
    return "".join(out)


def build() -> str:
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">',
        f"<defs>{markers()}</defs>",
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="white"/>',
        text(WIDTH / 2, 36, "LectureKaki architecture (November 2026)", size=22, weight="bold"),
    ]

    for i, (x, y, w, h, title) in enumerate(GROUPS):
        fill, stroke = ("#f5f7fa", "#8a96a3") if i == 0 else ("#edf3ea", "#a9b8a3")
        parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
        parts.append(text(x + 12, y + 20, title, size=13 if i else 14, weight="bold", anchor="start"))

    for kind, points, *_rest, double in EDGES:
        parts.append(line(points, kind, double))

    for path, x, y, service, role in NODES.values():
        half = ICON / 2
        parts.append(f'<image href="{icon(path)}" x="{x - half}" y="{y - half}" width="{ICON}" height="{ICON}"/>')
        parts.append(text(x, y + half + 16, service, size=13, weight="bold", halo=True))
        parts.append(text(x, y + half + 31, role, size=11.5, color="#3e4c59", halo=True))

    # Edge labels last, so they sit on top of any line they cross.
    for kind, _points, label, lx, ly, anchor, _double in EDGES:
        if label:
            parts.append(text(lx, ly, label, size=12, anchor=anchor, color=kind["color"], halo=True))

    lx, ly = 20, 860
    parts.append(f'<rect x="{lx}" y="{ly}" width="290" height="185" rx="10" fill="white" stroke="#8a96a3" stroke-width="1.5"/>')
    parts.append(text(lx + 14, ly + 24, "Legend", size=14, weight="bold", anchor="start"))
    for i, (name, kind, double) in enumerate(LEGEND):
        y = ly + 60 + i * 34
        parts.append(line([(lx + 16, y), (lx + 86, y)], kind, double))
        parts.append(text(lx + 100, y + 4, name, size=13, anchor="start"))

    parts.append("</svg>")
    return "\n".join(parts)


if __name__ == "__main__":
    svg = HERE / "architecture.svg"
    svg.write_text(build())
    # 2x for print.
    subprocess.run(
        ["rsvg-convert", "--zoom=2", "--format=png", "--output", str(HERE / "architecture.png"), str(svg)],
        check=True,
    )
    print(f"Wrote {svg} and architecture.png")
