# Cost Check for Cloud

- AWS
- Google Cloud
- Azure
- DigitalOcean

## ディレクトリ構成

```
/ (リポジトリルート)
├── .github/
│   ├── workflows/
│   │   └── do-cost-check.yml
├── aws/
│   ├── nodejs/
│   │   ├── thanks4ven/
│   │   │   ├── index.mjs
│   │   │   ├── package.json
│   │   │   └── .env.sample.yaml
│   │   └── README.md
│   ├── python/
│   │   ├── thanks2music/
│   │   │   ├── main.py
│   │   │   ├── requirements.txt
│   │   │   └── config.sample.yaml
│   │   └── README.md
│   └── README.md
├── gcp/
│   ├── nodejs/
│   │   ├── comeback.sickboy/
│   │   │   ├── index.mjs
│   │   │   ├── package.json
│   │   │   └── .env.sample.yaml
│   │   └── README.md
│   ├── cloudbuild.yaml
│   └── README.md
├── azure/
│   └── README.md  # 今後の実装のためのプレースホルダー
├── digitalocean/
│   ├── nodejs/
│   │   ├── thanks4ven/
│   │   │   ├── src/
│   │   │   ├──── cost-checker.mjs
│   │   │   ├── package.json
│   │   │   └── .env.sample
│   │   └── README.md
├── .github/
│   └── workflows/
│       ├── aws-nodejs-deploy.yml
│       ├── aws-python-deploy.yml
│       └── gcp-nodejs-deploy.yml
├── .gitignore
└── README.md
```