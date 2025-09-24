# Development Setup

## Environment Configuration

### 1. Copy Environment Template
```bash
cp .env.template .env
```

### 2. Configure Telemetry (Optional)
Edit `.env` and add your Application Insights connection string:
```bash
TELEMETRY_KEY=InstrumentationKey=your-key-here;IngestionEndpoint=https://your-region.in.applicationinsights.azure.com/;LiveEndpoint=https://your-region.livediagnostics.monitor.azure.com/;ApplicationId=your-app-id
```

### 3. Development Build
```bash
# Development build (no secrets required)
npm run build:dev

# Production build (requires telemetry key)
npm run build:production
```

## GitHub Secrets Setup

For CI/CD, add these secrets to your GitHub repository:

1. Go to Repository → Settings → Secrets and variables → Actions
2. Add the following secrets:

### Required Secrets:
- `TELEMETRY_KEY`: Your Application Insights connection string
- `VSCE_PAT`: Personal Access Token for VS Code Marketplace

### Optional Secrets:
- `APPLICATION_INSIGHTS_KEY`: Alternative name for telemetry key
- `NETAPP_API_KEY`: For NetApp API integration (if used)

## Build Scripts

- `npm run build:dev` - Development build without secrets
- `npm run build:production` - Production build with secret injection
- `npm run package` - Create VSIX package
- `npm run publish` - Publish to marketplace

## Telemetry

Telemetry is optional and will be disabled if no key is provided. The extension will work normally without telemetry configuration.

## Security Notes

- Never commit `.env` files
- Never commit actual telemetry keys
- Use environment variables for all secrets
- The `scripts/build-with-secrets.js` injects secrets at build time
- Generated files in `out/` directory are ignored by git