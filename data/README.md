# Local data

| Folder | Contents | In Git |
| --- | --- | --- |
| `raw/` | PSI metadata and experiment tables as downloaded, with a URL and SHA-256 manifest per snapshot | No |
| `processed/` | The validated catalog (`catalog.json`) read by the API and the static export | No |
| `documents/`, `indexes/` | Reserved for full texts and retrieval indexes | No |

The web app uses the exported copy in `apps/web/public/data`, which is committed so the site runs without fetching anything. See [pipelines/README.md](../pipelines/README.md) to refresh it.
