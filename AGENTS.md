## Long-Running Task Workflow

This project uses incremental multi-session progress tracking.

On every new session:
1. Run `pwd` to see the directory you're working in
2. Read `claude-progress.txt` and git logs to get up to speed
3. Read `feature_list.json` and choose the highest-priority feature that's not yet done
4. Run `init.sh` to start the dev environment
5. Run a basic test on the running app to verify it's not broken
6. Work on ONE feature at a time. Test it thoroughly before marking as passing
7. Commit progress and update `claude-progress.txt` before ending

Tracking files: `feature_list.json` (feature list), `claude-progress.txt` (session log)

