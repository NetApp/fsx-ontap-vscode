import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, _Object } from "@aws-sdk/client-s3";
import { state } from "./state";

/** FSx for ONTAP S3 access point reference (from DescribeS3AccessPointAttachments). */
export interface S3AccessPointRef {
    ResourceARN?: string;
    Alias?: string;
}

/** Prefer access point alias over ARN — required for reliable PutObject on FSx ONTAP access points. */
export function resolveS3Bucket(accessPoint?: S3AccessPointRef): string {
    return accessPoint?.Alias || accessPoint?.ResourceARN || '';
}

function isS3AccessPointArn(bucket: string): boolean {
    return bucket.startsWith('arn:aws:s3:') && bucket.includes(':accesspoint/');
}

function createS3Client(region: string, bucket: string): S3Client {
    return new S3Client({
        region,
        useArnRegion: isS3AccessPointArn(bucket),
        credentials: {
            accessKeyId: state.currentAccessKeyId,
            secretAccessKey: state.currentSecretAccessKey,
        },
    });
}

export async function listObjects(
    accessPoint: S3AccessPointRef,
    region: string,
    continuationToken?: string
): Promise<{ objects: _Object[]; nextContinuationToken?: string; isTruncated: boolean }> {
    const bucketName = resolveS3Bucket(accessPoint);
    state.reporter.sentTelemetryTypeEvent('GET', 'list-objects', { region, bucketName });
    const client = createS3Client(region, bucketName);
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
    accessPoint: S3AccessPointRef,
    key: string,
    region: string
): Promise<string> {
    const bucketName = resolveS3Bucket(accessPoint);
    state.reporter.sentTelemetryTypeEvent('GET', 'get-object', { region, bucketName, key });
    const client = createS3Client(region, bucketName);
    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
    });
    const response = await client.send(command);
    return await response.Body?.transformToString() ?? '';
}

export async function putObject(
    accessPoint: S3AccessPointRef,
    key: string,
    region: string,
    body: Buffer
): Promise<void> {
    const bucketName = resolveS3Bucket(accessPoint);
    if (!bucketName) {
        throw new Error('S3 access point has no alias or resource ARN.');
    }
    state.reporter.sentTelemetryTypeEvent('PUT', 'put-object', { region, bucketName, key });
    const client = createS3Client(region, bucketName);
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: body,
        StorageClass: 'FSX_ONTAP',
    });
    await client.send(command);
}
