import { S3Client, ListObjectsV2Command, GetObjectCommand, _Object } from "@aws-sdk/client-s3";
import { state } from "./state";

export async function listObjects(
    bucketName: string,
    region: string,
    continuationToken?: string
): Promise<{ objects: _Object[]; nextContinuationToken?: string; isTruncated: boolean }> {
    state.reporter.sentTelemetryTypeEvent('GET', 'list-objects', { region, bucketName });
    const client = new S3Client({
        region,
        credentials: {
            accessKeyId: state.currentAccessKeyId,
            secretAccessKey: state.currentSecretAccessKey,
        },
    });
    const command = new ListObjectsV2Command({
        Bucket: bucketName,
        MaxKeys: 10,
        ContinuationToken: continuationToken,
    });
    const response = await client.send(command);
    return {
        objects: response.Contents ?? [],
        nextContinuationToken:
            response.IsTruncated ? (response.NextContinuationToken ?? undefined) : undefined,
        isTruncated: response.IsTruncated ?? false,
    };
}

export async function getObject(
    bucketName: string,
    key: string,
    region: string
): Promise<string> {
    state.reporter.sentTelemetryTypeEvent('GET', 'get-object', { region, bucketName, key });
    const client = new S3Client({
        region,
        credentials: {
            accessKeyId: state.currentAccessKeyId,
            secretAccessKey: state.currentSecretAccessKey,
        },
    });
    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
    });
    const response = await client.send(command);
    return await response.Body?.transformToString() ?? '';
}