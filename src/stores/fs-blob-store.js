import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { PassThrough } from 'stream';
import LRU from 'lru-cache';
import mkdirp from 'mkdirp';
import rimraf from 'rimraf';
import through2 from 'through2';
import crypto from 'crypto';
import eos from 'end-of-stream';
import readdirp from 'readdirp';
import pumpify from 'pumpify';

export default class FsBlobStore {
  constructor(config) {
    this.root =
      config.fsBlobStoreRoot ||
      process.env['FS_BLOB_STORE_ROOT'] ||
      path.join(process.cwd(), 'blobs'); // set to `/data/blobs` in prod
    this.cache = new LRU(config.cache || 100);
  }

  createReadStream(params) {
    const filePath = path.join(
      this.root,
      params.graphId,
      params.resourceId,
      params.encodingId
    );
    const offsets = {
      start:
        params.range && params.range[0] != null ? params.range[0] : undefined,
      end: params.range && params.range[1] != null ? params.range[1] : undefined
    };

    if (!params.decompress) {
      return fs.createReadStream(filePath, offsets);
    }

    // potentially compressed case, we gzip if (and only if):
    // - the user asked for it (params.decompress)
    // - the file was gzip
    const proxy = new PassThrough();

    checkIfGzipped(filePath, (err, isGzipped) => {
      if (err) {
        proxy.emit('error', err);
      } else {
        const stream = fs.createReadStream(filePath, offsets);
        if (isGzipped && !params.range) {
          // We do not honor Range request on gzipped content (as Gunzip need header etc.)
          stream.pipe(zlib.createGunzip()).pipe(proxy);
        } else {
          stream.pipe(proxy);
        }
      }
    });

    return proxy;
  }

  createWriteStream(params, callback = () => {}) {
    const { compress = 'auto' } = params;
    const dir = path.join(this.root, params.graphId, params.resourceId);
    const key = path.join(dir, params.encodingId);

    let size = 0,
      sizeCompressed = 0;
    let sha = crypto.createHash('sha256'),
      shaCompressed;
    let isCompressed;

    function listen(stream, callback) {
      if (!callback) return stream;
      eos(stream, function(err) {
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
      return stream;
    }

    let proxy = listen(pumpify(), callback);

    function pipeAll(proxy) {
      if (
        compress === true ||
        (compress === 'auto' && /^text/.test(params.fileFormat))
      ) {
        isCompressed = true;
        shaCompressed = crypto.createHash('sha256');
        const spy1 = through2(function(chunk, encoding, cb) {
          size += chunk.length;

          sha.update(chunk);
          this.push(chunk);
          return cb();
        });

        const gzip = zlib.createGzip();

        const spy2 = through2(function(chunk, encoding, cb) {
          sizeCompressed += chunk.length;
          shaCompressed.update(chunk);
          this.push(chunk);
          return cb();
        });

        proxy.setPipeline(spy1, gzip, spy2, fs.createWriteStream(key));
      } else {
        let spy = through2(function(chunk, encoding, cb) {
          size += chunk.length;
          sha.update(chunk);
          this.push(chunk);
          return cb();
        });

        proxy.setPipeline(spy, fs.createWriteStream(key));
      }
    }

    if (this.cache.get(dir)) {
      pipeAll(proxy);
    } else {
      mkdirp(dir, err => {
        if (proxy.destroyed) {
          return;
        }
        if (err) return proxy.destroy(err);
        this.cache.set(dir, true);
        pipeAll(proxy);
      });
    }

    return proxy;
  }

  remove(params, callback) {
    if (
      params.graphId != null &&
      params.resourceId != null &&
      params.encodingId != null
    ) {
      const dir = path.join(this.root, params.graphId, params.resourceId);
      const key = path.join(dir, params.encodingId);
      this.cache.del(key);
      fs.unlink(key, err => {
        if (err) {
          if (err.code === 'ENOENT') {
            return callback(null, []);
          } else {
            return callback(err);
          }
        }
        callback(null, {
          graphId: params.graphId,
          resourceId: params.resourceId,
          encodingId: params.encodingId
        });
      });
    } else if (
      (params.graphId !== null &&
        params.resourceId !== null &&
        params.encodingId === null) ||
      (params.graphId !== null &&
        params.resourceId === null &&
        params.encodingId === null)
    ) {
      const dir = path.join.apply(
        path,
        [
          this.root,
          params.graphId,
          params.resourceId,
          params.encodingId
        ].filter(p => p != null)
      );

      readdirp
        .promise(dir)
        .then(entries => {
          const deleted = [];
          entries.forEach(entry => {
            const [graphId, resourceId, encodingId] = entry.fullPath
              .split('/')
              .slice(-3);
            deleted.push({ graphId, resourceId, encodingId });
            this.cache.del(path.join(this.root, graphId, resourceId));
          });
          rimraf(dir, err => {
            if (err) return callback(err);
            callback(null, deleted);
          });
        })
        .catch(err => {
          if (err.length === 1 && err[0].code === 'ENOENT') {
            return callback(null, []);
          } else {
            return callback(err);
          }
        });
    } else {
      callback(new Error('invalid params'));
    }
  }
}

function checkIfGzipped(filePath, callback) {
  // we read the first 2 bytes (see
  // https://stackoverflow.com/questions/6059302/how-to-check-if-a-file-is-gzip-compressed)
  fs.open(filePath, 'r', (err, fd) => {
    if (err) {
      return callback(err);
    }

    const b = Buffer.alloc(2);
    fs.read(fd, b, 0, 2, null, (err, bytesRead, b) => {
      if (err) {
        return callback(err);
      }

      const [b1, b2] = b;
      const isGzipped = b1 === 0x1f && b2 === 0x8b;
      fs.close(fd, err => {
        if (err) return callback(err);
        callback(null, isGzipped);
      });
    });
  });
}
