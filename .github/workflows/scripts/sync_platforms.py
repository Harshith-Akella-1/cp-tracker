"""Collects accepted LeetCode and GeeksforGeeks problems into data/external.json.
Runs inside GitHub Actions (servers can call these sites; browsers can't because of CORS).
Only adds entries, never removes them, so old solves stay recorded."""
import json, os, time, urllib.request

PATH = "data/external.json"
LC_USER = os.environ.get("LC_USER", "")
GFG_USER = os.environ.get("GFG_USER", "")


def post_json(url, body, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    os.makedirs("data", exist_ok=True)
    ext = {"leetcode": {}, "gfg": {}}
    if os.path.exists(PATH):
        with open(PATH) as f:
            ext.update(json.load(f))
    now = int(time.time())
    run = {"at": now, "leetcode": "skipped", "gfg": "skipped"}

    if LC_USER:
        try:
            q = {"query": "query r($u:String!,$l:Int!){recentAcSubmissionList(username:$u,limit:$l){title titleSlug timestamp}}",
                 "variables": {"u": LC_USER, "l": 20}}
            data = post_json("https://leetcode.com/graphql", q, {"Referer": "https://leetcode.com"})
            subs = data["data"]["recentAcSubmissionList"] or []
            new = 0
            for s in subs:
                if s["titleSlug"] not in ext["leetcode"]:
                    ext["leetcode"][s["titleSlug"]] = {"title": s["title"], "ts": int(s["timestamp"])}
                    new += 1
            run["leetcode"] = f"ok, {len(subs)} recent, {new} new"
        except Exception as e:
            run["leetcode"] = f"error: {e}"

    if GFG_USER:
        try:
            data = post_json("https://practiceapi.geeksforgeeks.org/api/v1/user/problems/submissions/",
                             {"handle": GFG_USER, "requestType": "", "year": "", "month": ""})
            new = total = 0
            for _difficulty, probs in (data.get("result") or {}).items():
                for p in (probs or {}).values():
                    total += 1
                    slug = p.get("slug") or p.get("pname", "")
                    if slug and slug not in ext["gfg"]:
                        ext["gfg"][slug] = {"name": p.get("pname", slug), "ts": now}
                        new += 1
            run["gfg"] = f"ok, {total} solved, {new} new"
        except Exception as e:
            run["gfg"] = f"error: {e}"

    ext["lastRun"] = run
    print(json.dumps(run))
    with open(PATH, "w") as f:
        json.dump(ext, f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
