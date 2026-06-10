import { S3Client, GetObjectCommand, PutObjectCommand, GetObjectCommandOutput, PutObjectCommandOutput } from '@aws-sdk/client-s3';

const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    // Only pass explicit credentials when configured, so the SDK's default provider chain still applies otherwise
    credentials: (process.env.S3_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID) ? {
        accessKeyId: (process.env.S3_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID)!,
        secretAccessKey: (process.env.S3_SECRET_KEY || process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY)!
    } : undefined,
    region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
    forcePathStyle: true, // often needed for custom endpoints like MinIO
});

const bucket = process.env.S3_BUCKET || '';
const cache: Record<string, { data: any, etag?: string }> = {};

const isNotModified = (err: any): boolean =>
    err?.$metadata?.httpStatusCode === 304 || err?.name === '304' || err?.name === 'NotModified';

const isNoSuchKey = (err: any): boolean =>
    err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;

const loadJSON = async <T = any>(key: string): Promise<T> => {
    const cached = cache[key];

    try {
        const data: GetObjectCommandOutput = await s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            IfNoneMatch: cached?.etag
        }));
        const body: string = await data.Body?.transformToString('utf-8') || '{}';
        const json: T = JSON.parse(body);
        cache[key] = {
            data: json,
            etag: data.ETag
        };
        return JSON.parse(JSON.stringify(json));
    } catch (err: any) {
        if (cached && isNotModified(err)) {
            return JSON.parse(JSON.stringify(cached.data));
        }
        if (isNoSuchKey(err)) {
            delete cache[key];
            return {} as T;
        }
        throw err;
    }
};

const saveJSON = async <T = any>(key: string, data: T): Promise<void> => {
    const res: PutObjectCommandOutput = await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(data, undefined, 4)
    }));

    cache[key] = {
        data: JSON.parse(JSON.stringify(data)),
        etag: res.ETag
    };
};

const save = async (key: string, body: any): Promise<void> => {
    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body
    }));
};

const readFile = async (key: string): Promise<Buffer | undefined> => {
    try {
        const data: GetObjectCommandOutput = await s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: key
        }));
        return data.Body ? Buffer.from(await data.Body.transformToByteArray()) : undefined;
    } catch (err: any) {
        if (isNoSuchKey(err)) {
            const error: any = new Error(`File not found: ${key}`);
            error.code = 'ENOENT';
            throw error;
        }
        throw err;
    }
};

export {
    s3,
    bucket,
    loadJSON,
    saveJSON,
    save,
    readFile
};
