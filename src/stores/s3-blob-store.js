import crypto from 'crypto';
import through2 from 'through2';
import pumpify from 'pumpify';
import { PassThrough } from 'stream';
import zlib from 'zlib';
import AWS from 'aws-sdk';
import createError from '@scipe/create-error';
import async from 'async';

// AWS SDK automatically detects AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
// AWS SDK doesn't select the region by default
AWS.config.update({ region: process.env['AWS_REGION'] });

export default class S3BlobStore {
  constructor(config) {
    this.s3 = new AWS.S3({
      params: {
        Bucket:
          config.s3BlobStoreRoot ||
          process.env['S3_BLOB_STORE_ROOT'] ||
          'sa-blobs'
      }
    });
  }

  getKey(params) {
    return (
      params.key ||
      ['blob', params.graphId, params.resourceId, params.encodingId].join('/')
    );
  }

  createReadStream(params) {
    const key = this.getKey(params);

    let proxy = new PassThrough();

    let s3Opt = { Key: key };
    if (params.range && params.range[0] != null) {
      s3Opt.Range = `bytes=${params.range[0]}-${
        params.range[1] != null ? params.range[1] : ''
      }`;
    }

    // see https://github.com/aws/aws-sdk-js/issues/330 as to why we first get the headers
    this.s3
      .getObject(s3Opt)
      .on('httpHeaders', function(statusCode, headers) {
        if (statusCode < 300) {
          const contentEncoding = headers['content-encoding'] || 'identity';
          var _stream = this.response.httpResponse.createUnbufferedStream();
          let decompress;
          if (params.decompress) {
            if (contentEncoding.match(/\bdeflate\b/)) {
              decompress = zlib.createInflate();
            } else if (contentEncoding.match(/\bgzip\b/)) {
              decompress = zlib.createGunzip();
            }
          }

          if (decompress) {
            _stream.pipe(decompress).pipe(proxy);
          } else {
            _stream.pipe(proxy);
          }
        } else {
          this.abort();
          this.response.error = createError(
            statusCode,
            `s3 getObjects returned a status code > 300 (${statusCode})`
          );
        }
      })
      .on('error', function(err) {
        proxy.emit('error', err);
      })
      .send();

    return proxy;
  }

  createWriteStream(params, callback = () => {}) {
    const { compress = 'auto' } = params;

    // TODO? create S3 bucket if it doesn't exists yet

    const key = this.getKey(params);
    let sha = crypto.createHash('sha256'),
      shaCompressed;
    let size = 0,
      sizeCompressed = 0;

    let proxy, isCompressed;
    if (
      compress === true ||
      (compress === 'auto' && /^text/.test(params.fileFormat))
    ) {
      isCompressed = true;
      shaCompressed = crypto.createHash('sha256');

      let spy1 = through2(function(chunk, encoding, cb) {
        size += chunk.length;
        sha.update(chunk);
        this.push(chunk);
        return cb();
      });

      let gzip = zlib.createGzip();

      let spy2 = through2(function(chunk, encoding, cb) {
        sizeCompressed += chunk.length;
        shaCompressed.update(chunk);
        this.push(chunk);
        return cb();
      });

      // proxy is a duplex stream that writes to the first streams and reads from the last one.
      proxy = pumpify(spy1, gzip, spy2);
    } else {
      proxy = through2(function(chunk, encoding, cb) {
        size += chunk.length;
        sha.update(chunk);
        this.push(chunk);
        return cb();
      });
    }

    let s3Params = {
      Key: key,
      Body: proxy,
      ContentType: params.fileFormat
    };

    if (isCompressed) {
      s3Params.ContentEncoding = 'gzip';
    }

    this.s3.upload(s3Params, (err, data) => {
      if (err) return callback(err);
      callback(null, {
        key: key,
        size: size,
        sha: sha.digest('base64'),
        compressed: isCompressed
          ? {
              encodingFormat: 'gzip',
              size: sizeCompressed,
              sha: shaCompressed.digest('base64')
            }
          : undefined
      });
    });

    return proxy;
  }

  deleteObjects(s3ObjectsParams, callback) {
    let statusCode;
    this.s3
      .deleteObjects(
        {
          Delete: {
            Objects: s3ObjectsParams
          }
        },
        (err, data) => {
          if (err) return callback(err);
          if (statusCode === 404) {
            return callback(null, []);
          } else if (statusCode >= 400) {
            return callback(createError(statusCode, data));
          }
          callback(
            null,
            data.Deleted.map(x => {
              const [graphId, resourceId, encodingId] = x.Key.split('/').slice(
                1
              );
              return { graphId, resourceId, encodingId };
            })
          );
        }
      )
      .on('httpHeaders', (_statusCode, headers, response) => {
        statusCode = _statusCode;
      });
  }

  remove(params, callback) {
    if (
      params.graphId != null &&
      params.resourceId != null &&
      params.encodingId != null
    ) {
      this.deleteObjects(
        [
          {
            Key: [
              'blob',
              params.graphId,
              params.resourceId,
              params.encodingId
            ].join('/')
          }
        ],
        callback
      );
    } else if (
      (params.graphId !== null &&
        params.resourceId !== null &&
        params.encodingId === null) ||
      (params.graphId !== null &&
        params.resourceId === null &&
        params.encodingId === null)
    ) {
      const prefix =
        ['blob', params.graphId, params.resourceId, params.encodingId]
          .filter(p => p != null)
          .join('/') + '/';

      let isTruncated = false;
      let keys = [];
      async.doWhilst(
        cb => {
          let s3Params = {
            Prefix: prefix
          };
          if (isTruncated) {
            s3Params.Marker = keys[keys.length - 1].Key;
          }
          this.s3.listObjects(s3Params, function(err, data) {
            if (err) return cb(err);
            isTruncated = data.IsTruncated;
            keys = keys.concat(
              data.Contents.map(content => {
                return { Key: content.Key };
              })
            );
            cb(null);
          });
        },
        () => {
          return isTruncated;
        },
        err => {
          if (err) return callback(err);
          if (!keys.length) {
            return callback(null, []);
          }
          this.deleteObjects(keys, callback);
        }
      );
    } else {
      callback(new Error('invalid params'));
    }
  }
}
