"""起動イントロ「測量」の地図データを作る。

入力は2つ。ネットワークへは取りに行かないので、先に手で用意する。

- OpenStreetMap: Overpass API に次の問い合わせを送った結果（JSON）
    [out:json][timeout:100][bbox:34.764,135.618,34.791,135.650];
    (way[highway];way[railway];way[building];relation[building];way[waterway];way[natural=water];
     way[leisure];way[landuse];way[amenity=school];);
    out geom tags;
  建物は relation（multipolygon）で登録されたものもある（学校の図書館「繋真館」など）ので、
  relation[building] も取る。外周（outer）だけを使い、中庭などの穴（inner）は描かない。
- 国土地理院の標高タイル（dem5a、ズーム15）の txt を1つのディレクトリに
  dem5a_15_<x>_<y>.txt の名前で置いたもの

例:
    python tools/build_intro_atlas.py --osm area.json --dem dem/ \
        --out templates/minimal/demo-intro-atlas-map.json
"""
import argparse
import json
import math
from pathlib import Path

LAT0, LON0 = 34.779, 135.6328
KX, KY = math.cos(math.radians(LAT0)) * 111320, 110574
REGION = (-1000, -1050, 900, 1200)
CAMPUS_WAY = 99836016
STATION = (-170, 617)
RAIL_FROM, RAIL_TO = (-1177, -1743), (-239, 2080)
DEM_ZOOM = 15
TERRAIN_STEP = 30
# 建物は学校と駅のまわりだけ。全域（約1.4万棟）を線で描くと、1フレームに1秒近くかかる。
BUILDING_REACH = {"school": 620, "station": 380}
BUILDING_MIN_AREA = 60
ROAD_CLASS = {
    "trunk": 0, "primary": 0, "secondary": 0, "tertiary": 0,
    "residential": 1, "unclassified": 1, "service": 1, "pedestrian": 1,
    "footway": 2, "path": 2, "cycleway": 2, "steps": 2, "track": 2,
}


def local(point):
    return (point["lon"] - LON0) * KX, (point["lat"] - LAT0) * KY


def inside(x, y, margin=0):
    x0, y0, x1, y1 = REGION
    return x0 - margin <= x <= x1 + margin and y0 - margin <= y <= y1 + margin


def simplify(points, tolerance):
    if len(points) < 3:
        return points
    (ax, ay), (bx, by) = points[0], points[-1]
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    best, index = -1, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        distance = abs(dy * (px - ax) - dx * (py - ay)) / length if length else math.hypot(px - ax, py - ay)
        if distance > best:
            best, index = distance, i
    if best <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[:index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def area(points):
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]))) / 2


def flat(points, digits=0):
    out = []
    for x, y in points:
        out += [round(x, digits) if digits else round(x), round(y, digits) if digits else round(y)]
    return out


def point_in(points, x, y):
    hit = False
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            hit = not hit
    return hit


class Elevation:
    def __init__(self, directory):
        self.tiles = {}
        for path in Path(directory).glob(f"dem5a_{DEM_ZOOM}_*_*.txt"):
            _, _, x, y = path.stem.split("_")
            rows = [[None if v == "e" else float(v) for v in line.split(",")] for line in path.read_text().split()]
            self.tiles[int(x), int(y)] = rows

    def raw(self, lat, lon):
        n = 2 ** DEM_ZOOM
        fx = (lon + 180) / 360 * n
        fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        tile = self.tiles.get((int(fx), int(fy)))
        if tile is None:
            return None
        return tile[min(255, int((fy % 1) * 256))][min(255, int((fx % 1) * 256))]

    def at(self, x, y):
        lat, lon = LAT0 + y / KY, LON0 + x / KX
        for radius in (0, 6, 12, 24, 48):
            values = [self.raw(lat + dy / KY, lon + dx / KX)
                      for dx in (-radius, 0, radius) for dy in (-radius, 0, radius)] if radius else [self.raw(lat, lon)]
            values = [v for v in values if v is not None]
            if values:
                return sum(values) / len(values)
        return 0.0


def rail_path(ways):
    """複線のうち片側1本を、南端から北端まで端点をつないでたどる。"""
    key = lambda p: (round(p[0]), round(p[1]))
    edges = {}
    for points in ways:
        a, b = key(points[0]), key(points[-1])
        length = sum(math.dist(p, q) for p, q in zip(points, points[1:]))
        edges.setdefault(a, []).append((b, length, points))
        edges.setdefault(b, []).append((a, length, points[::-1]))
    nearest = lambda target: min(edges, key=lambda node: math.dist(node, target))
    start = nearest(RAIL_FROM)
    best, previous, queue = {start: 0}, {}, [start]
    while queue:
        node = min(queue, key=best.get)
        queue.remove(node)
        for nxt, length, points in edges[node]:
            cost = best[node] + length
            if cost < best.get(nxt, math.inf):
                best[nxt], previous[nxt] = cost, (node, points)
                queue.append(nxt)
    goal = min(best, key=lambda node: math.dist(node, RAIL_TO))
    path, node = [], goal
    while node != start:
        node, points = previous[node]
        path = points[1:] + path if path else points
    return [path[0]] + [p for p, q in zip(path[1:], path) if math.dist(p, q) > 0.5]


def outer_rings(relation):
    """multipolygon の outer を閉じた輪にする。途中で分かれた way はつなぐ。"""
    pieces = [[local(p) for p in m["geometry"]] for m in relation.get("members", [])
              if m.get("type") == "way" and m.get("role") == "outer" and m.get("geometry")]
    rings = []
    while pieces:
        ring = pieces.pop(0)
        while ring[0] != ring[-1]:
            for i, piece in enumerate(pieces):
                if piece[0] == ring[-1]:
                    ring += piece[1:]
                elif piece[-1] == ring[-1]:
                    ring += piece[::-1][1:]
                else:
                    continue
                pieces.pop(i)
                break
            else:
                break
        rings.append(ring if ring[0] == ring[-1] else ring + ring[:1])
    return rings


def build(osm, elevation):
    elements = json.loads(Path(osm).read_text())["elements"]
    campus = next(e for e in elements if e["id"] == CAMPUS_WAY)
    campus_points = [local(p) for p in campus["geometry"]][:-1]
    school = [sum(c) / len(c) for c in zip(*campus_points)]
    buildings, roads, water, grounds, rails, platforms = [], [], [], [], [], []
    shapes = []
    for element in elements:
        tags = element.get("tags", {})
        if element["type"] == "way" and element.get("geometry"):
            shapes.append((tags, [local(p) for p in element["geometry"]]))
        elif element["type"] == "relation" and "building" in tags and tags.get("type") == "multipolygon":
            shapes += [(tags, ring) for ring in outer_rings(element)]
    for tags, points in shapes:
        if not any(inside(x, y, 200) for x, y in points):
            continue
        if "building" in tags:
            ring = simplify(points, 0.8)[:-1]
            if len(ring) < 3:
                continue
            cx, cy = sum(x for x, _ in ring) / len(ring), sum(y for _, y in ring) / len(ring)
            on_campus = point_in(campus_points, cx, cy)
            near = math.dist((cx, cy), school) < BUILDING_REACH["school"] or math.dist((cx, cy), STATION) < BUILDING_REACH["station"]
            if not on_campus and (area(ring) < BUILDING_MIN_AREA or not near):
                continue
            levels = tags.get("building:levels")
            if levels and levels.replace(".", "").isdigit():
                height = float(levels) * 3.2
            elif on_campus:
                height = 15 if area(ring) > 600 else 9
            else:
                footprint = area(ring)
                # 階数の情報がほぼ無い。面積と場所から決まる値にして、毎回同じ街並みにする。
                jitter = (int(abs(cx) * 7 + abs(cy) * 13) % 5) * 0.6
                height = 6 + jitter if footprint < 160 else 9 + jitter * 2 if footprint < 500 else 16 + jitter * 4
            buildings.append({"p": flat(ring), "h": round(height), "z": round(elevation.at(cx, cy), 1),
                              **({"c": 1} if on_campus else {})})
        elif tags.get("railway") == "rail" and tags.get("service") != "crossover":
            rails.append(points)
        elif tags.get("railway") == "platform":
            platforms.append(points)
        elif tags.get("highway") in ROAD_CLASS:
            roads.append({"c": ROAD_CLASS[tags["highway"]], "p": flat(simplify(points, 1.2))})
        elif "waterway" in tags or tags.get("natural") == "water":
            water.append(flat(simplify(points, 1.5)))
        elif tags.get("leisure") in ("pitch", "track") and any(point_in(campus_points, x, y) for x, y in points):
            grounds.append(flat(simplify(points, 1)))
    main = rail_path(rails)
    platform = [sum(c) / len(c) for c in zip(*[p for points in platforms for p in points if math.dist(p, STATION) < 200])]
    x0, y0, x1, y1 = REGION
    nx, ny = (x1 - x0) // TERRAIN_STEP + 1, (y1 - y0) // TERRAIN_STEP + 1
    heights = [round(elevation.at(x0 + i * TERRAIN_STEP, y0 + j * TERRAIN_STEP), 1) for j in range(ny) for i in range(nx)]
    return {
        "attribution": "© OpenStreetMap contributors (ODbL) / 標高: 国土地理院 基盤地図情報数値標高モデル",
        "origin": {"lat": LAT0, "lon": LON0},
        "school": {"name": "同志社香里", "x": round(school[0]), "y": round(school[1]),
                   "z": round(elevation.at(*school), 1), "lat": round(LAT0 + school[1] / KY, 4), "lon": round(LON0 + school[0] / KX, 4)},
        "station": {"name": "香里園", "x": round(platform[0]), "y": round(platform[1]),
                    "z": round(elevation.at(*platform), 1), "lat": round(LAT0 + platform[1] / KY, 4), "lon": round(LON0 + platform[0] / KX, 4)},
        "campus": flat(campus_points),
        "terrain": {"x0": x0, "y0": y0, "step": TERRAIN_STEP, "nx": nx, "ny": ny, "h": heights},
        "rail": {"main": flat(main, 1), "z": [round(elevation.at(x, y), 1) for x, y in main],
                 "others": [flat(simplify(points, 1)) for points in rails]},
        "roads": roads, "water": water, "grounds": grounds, "buildings": buildings,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--osm", required=True)
    parser.add_argument("--dem", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    data = build(args.osm, Elevation(args.dem))
    Path(args.out).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"buildings {len(data['buildings'])}, roads {len(data['roads'])}, rail {len(data['rail']['main']) // 2} pts,"
          f" {Path(args.out).stat().st_size // 1024} KiB")
