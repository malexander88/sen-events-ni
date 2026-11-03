#!/usr/bin/env python3
"""Moderation step for parent reviews (v1.9.4).

Usage:  python3 tools/approve_review.py <issue-number> [--dry-run]

Reads a "Parent review" issue (submitted from the app via the GitHub issue form), adds it to
reviews.json and its three copies (www/, docs/, android assets), comments on and closes the issue.
Only run it for reviews a person has read and approved. Needs the `gh` CLI logged in with repo access.
Commit and push afterwards (git pull --rebase first).
"""
import json, re, subprocess, sys, datetime
REPO = 'malexander88/sen-events-ni'
COPIES = ['reviews.json', 'www/reviews.json', 'docs/reviews.json', 'android/app/src/main/assets/reviews.json']
LABELS = {'Event ID': 'eventId', 'Event or place': 'eventName', 'Rating': 'rating', 'When did you go? (optional)': 'visited',
          'Your review': 'text', 'Tips for SEN families (optional)': 'senNotes', 'Name to show (optional)': 'author'}

def gh(*a): return subprocess.run(['gh', *a], check=True, capture_output=True, text=True).stdout

def parse(body):
    out = {}
    for m in re.finditer(r'^### (.+?)\s*\n(.*?)(?=^### |\Z)', body, re.S | re.M):
        k = LABELS.get(m.group(1).strip()); v = m.group(2).strip()
        if k and v and v != '_No response_': out[k] = v
    return out

def main():
    n = int(sys.argv[1]); dry = '--dry-run' in sys.argv
    issue = json.loads(gh('api', f'repos/{REPO}/issues/{n}'))
    f = parse(issue.get('body') or '')
    if not f.get('eventId') or not f.get('text') or not f.get('rating'): sys.exit('Issue #%d is missing event id, rating or review text' % n)
    r = {'id': 'gh-%d' % n, 'eventId': f['eventId'], 'eventName': f.get('eventName', ''), 'rating': int(f['rating'][0]),
         'text': f['text'], 'senNotes': f.get('senNotes'), 'visited': f.get('visited'), 'author': f.get('author') or 'A parent',
         'date': issue['created_at'][:10], 'source': issue['html_url']}
    data = json.load(open(COPIES[0]))
    data['reviews'] = [x for x in data['reviews'] if x.get('id') != r['id']] + [r]
    data['updatedAt'] = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    print(json.dumps(r, indent=2, ensure_ascii=False))
    if dry: return
    s = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
    for p in COPIES: open(p, 'w').write(s)
    gh('issue', 'comment', str(n), '-R', REPO, '-b', 'Thanks! This review has been approved and will appear in the app after the next update.')
    gh('issue', 'close', str(n), '-R', REPO)
    print('Added to', ', '.join(COPIES), '- now commit and push.')

if __name__ == '__main__': main()
