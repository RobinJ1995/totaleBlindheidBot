import AWS from 'aws-sdk';

const s3 = new AWS.S3({
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.S3_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_KEY || process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.S3_REGION || process.env.AWS_REGION,
    s3ForcePathStyle: true, // often needed for custom endpoints like MinIO
});

const bucket = process.env.S3_BUCKET || '';
const cache: Record<string, { data: any, etag?: string }> = {};

const loadJSON = async <T = any>(key: string): Promise<T> => {
    const cached = cache[key];
    const params: AWS.S3.GetObjectRequest = { Bucket: bucket, Key: key };
    if (cached?.etag) {
        params.IfNoneMatch = cached.etag;
    }

    try {
        const data: AWS.S3.GetObjectOutput = await s3.getObject(params).promise();
        const body: string = data.Body?.toString('utf-8') || '{}';
        const json: T = JSON.parse(body);
        cache[key] = {
            data: json,
            etag: data.ETag
        };
        return JSON.parse(JSON.stringify(json));
    } catch (err: any) {
        if (cached && (err.statusCode === 304 || err.code === 'NotModified')) {
            return JSON.parse(JSON.stringify(cached.data));
        }
        if (err.code === 'NoSuchKey') {
            delete cache[key];
            return {} as T;
        }
        throw err;
    }
};

const saveJSON = async <T = any>(key: string, data: T): Promise<void> => {
    const res: AWS.S3.PutObjectOutput = await s3.putObject({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(data, undefined, 4)
    }).promise();

    cache[key] = {
        data: JSON.parse(JSON.stringify(data)),
        etag: res.ETag
    };
};

const save = async (key: string, body: any): Promise<void> => {
    await s3.putObject({
        Bucket: bucket,
        Key: key,
        Body: body
    }).promise();
};

const readFile = async (key: string): Promise<AWS.S3.Body | undefined> => {
    try {
        const data: AWS.S3.GetObjectOutput = await s3.getObject({
            Bucket: bucket,
            Key: key
        }).promise();
        return data.Body;
    } catch (err: any) {
        if (err.code === 'NoSuchKey' || err.statusCode === 404) {
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
