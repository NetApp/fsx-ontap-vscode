#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Build script that injects secrets during build time
 * This ensures secrets are not committed to git but are available during build
 */

function injectTelemetryKey() {
    const telemetryKey = process.env.TELEMETRY_KEY || process.env.APPLICATION_INSIGHTS_KEY;
    const telemetryHMACKey = process.env.TELEMETRY_HMAC_KEY || process.env.APPLICATION_INSIGHTS_HMAC_KEY;
    
    if (!telemetryKey) {
        console.warn('⚠️  No telemetry key found in environment variables');
        console.warn('   Set TELEMETRY_KEY or APPLICATION_INSIGHTS_KEY environment variable');
        console.warn('   Telemetry will be disabled in this build');
        return;
    }
    
    const telemetryFilePath = path.join(__dirname, '../out/telemetryKey.js');
    const telemetryContent = `
// Auto-generated telemetry configuration
// This file is generated during build and should not be committed to git

exports.TelemetryKey = '${telemetryKey}';
exports.TelemetryExternalHMACKey = '${telemetryHMACKey || ''}';

exports.isTelemetryEnabled = function() {
    return exports.TelemetryKey.length > 0;
};

exports.getTelemetryConfig = function() {
    if (!exports.isTelemetryEnabled()) {
        return null;
    }
    
    return {
        key: exports.TelemetryKey,
        hmacKey: exports.TelemetryExternalHMACKey,
        enabled: true
    };
};
`;
    
    // Ensure out directory exists
    const outDir = path.dirname(telemetryFilePath);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    
    fs.writeFileSync(telemetryFilePath, telemetryContent);
    console.log('✅ Telemetry key injected successfully');
}

function validateEnvironment() {
    const requiredVars = ['TELEMETRY_KEY'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        console.warn('⚠️  Missing environment variables:', missingVars.join(', '));
        console.warn('   Extension will work but telemetry will be disabled');
    }
}

function main() {
    console.log('🔧 Building extension with secrets...');
    
    validateEnvironment();
    injectTelemetryKey();
    
    console.log('✅ Build preparation complete');
}

if (require.main === module) {
    main();
}

module.exports = { injectTelemetryKey, validateEnvironment };