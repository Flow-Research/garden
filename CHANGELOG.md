# Changelog

All notable changes to Garden are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-08

First release. Covers 72 pull requests merged to `dev` since `main` was last updated on 2026-09-25.

### Added
- Teams with shared issue boards; every member sees the whole board; Teams admin in Settings (#147, #168, #295, #288).
- GitHub issue sync: link a repository to a Team, import open issues, sync issues, comments, assignees, and closes by webhook; member GitHub identity linking (#298, #236, #170, #196).
- Decide data analysis in chat as a durable background job, with progress, files, failure reasons, and Brain file input up to 100 MB (#169, #195, #204, #206, #242, #250, #253, #256, #258, #259, #260).
- Automations can run Decide and resume with the result (#261).
- Inbox with Gmail (#125, #129, #131); rich-text chat composer and message queue (#126).
- Internal handbook at `/handbook`; docs restructured by Diátaxis (#262, #289, #290).

### Changed
- Original Garden colours restored; frontend audit fixes; compact issue board cards and a responsive issues header for small screens (#286, #238, #167).
- Removing a Team member moves their open Team issues to the Team owner (#282).
- Concurrent async calls on hot paths; non-blocking navigation preload (#248, #121).
- Brain improvements; better connector search (#134, #133).

### Fixed
- Handbook MDX config kept out of the client bundle; link plugin no longer crashes the Worker (#299, #284).
- Run lifecycle races, scoped Executor MCP sessions, Executor tool discovery (#241, #239, #124).
- Decide and MCP error handling and execution (#205, #218, #228–#233, #235).
- Shared issue Brain context limited to the organisation (#149).
- Chat first-message and scroll fixes; agent auth decoupled from OAuth; lazy Google linking; realtime binding; issue delete and search (#252, #97, #128, #120, #177, #138, #179, #135).
- New users land in the right workspace after first signup (#280); Team membership errors name the actual cause (#292); inactive tab hover no longer looks selected (#237).

### Known issues
- Invites do not add people to a Team; agent `create_issue` cannot set Team or assignees; no health route or staging smoke suite; #293, #294, #296, #297 open.

[0.1.0]: https://github.com/Flow-Research/garden/releases/tag/v0.1.0
