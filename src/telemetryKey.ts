// Telemetry configuration
export const TelemetryKey = process.env.TELEMETRY_KEY || 
    process.env.APPLICATION_INSIGHTS_KEY || 
    ''; // Empty string as fallback - no telemetry if not configured

// Helper function to check if telemetry is enabled
export function isTelemetryEnabled(): boolean {
    return TelemetryKey.length > 0;
}

// Get telemetry configuration
export function getTelemetryConfig() {
    if (!isTelemetryEnabled()) {
        return null;
    }
    
    return {
        key: TelemetryKey,
        enabled: true
    };
}