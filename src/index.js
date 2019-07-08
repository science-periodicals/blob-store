import fs from 'fs';
import path from 'path';
import concat from 'concat-stream';
import once from 'once';
import mime from 'mime-types';
import { Readable } from 'stream';
import { getId, unprefix } from '@scipe/jsonld';
import FsBlobStore from './stores/fs-blob-store';
import S3BlobStore from './stores/s3-blob-store';

export default class BlobStore {
  constructor(config) {
    config = config || {};

    this.blobStorageBackend =
      config.blobStorageBackend || process.env.BLOB_STORAGE_BACKEND || 'fs';

    switch (this.blobStorageBackend) {
      case 'S3':
        this.store = new S3BlobStore(config);
        break;
      case 'fs':
        this.store = new FsBlobStore(config);
        break;
      default:
        throw new Error('invalid store');
    }

    if (config.apiPathnamePrefix != null) {
      //can be ''
      this.API_PATHNAME_PREFIX = config.apiPathnamePrefix;
    } else if (process.env['API_PATHNAME_PREFIX'] != null) {
      this.API_PATHNAME_PREFIX = process.env['API_PATHNAME_PREFIX'];
    } else {
      this.API_PATHNAME_PREFIX = '/encoding/';
    }
  }

  getBlobStorageBackend() {
    return this.blobStorageBackend;
  }

  getParams(encoding = {}, params) {
    params = params || {}; // sometimes params is `null`

    // In the blob store sense:
    // `graphId` can be the @id of a Graph, Periodical, Person or Organization
    // `resourceId` is the @id CreativeWork or a Cssvariable
    // Note: in case of issues, the issueId is irrelevant for the blob store

    // if the user did not pass an encoding but some API parameters extract those first
    // also contains aliases
    const apiParams = {
      '@id': 'encodingId',
      id: 'encodingId',
      '@type': '@type',
      type: '@type',
      encodingType: '@type',
      userId: 'graphId',
      organizationId: 'graphId',
      periodicalId: 'graphId',
      property: 'resourceId',
      graphId: 'graphId',
      issueId: 'issueId',
      isNodeOfId: 'isNodeOfId',
      encodesCreativeWork: 'encodesCreativeWork',
      resourceId: 'resourceId',
      encodingId: 'encodingId',
      contentUrl: 'contentUrl',
      fileFormat: 'fileFormat',
      contentSize: 'contentSize',
      size: 'contentSize',
      compress: 'compress',
      decompress: 'decompress',
      range: 'range',
      buffer: 'body',
      body: 'body',
      path: 'path',
      creator: 'creator',
      name: 'name',
      // convenience pass through props
      isBasedOn: 'isBasedOn',
      isNodeOf: 'isNodeOf'
    };

    const parsed = {};

    const resource = encoding.encodesCreativeWork;
    if (resource) {
      const id = getId(resource);
      if (id) {
        parsed.resourceId = id;

        if (
          id.startsWith('graph:') ||
          id.startsWith('journal:') ||
          id.startsWith('user:') ||
          id.startsWith('org:')
        ) {
          parsed.graphId = id;
        } else if (id.startsWith('issue:')) {
          parsed.issueId = id;
        }
      }

      if (resource.isNodeOf) {
        const isNodeOfId = getId(resource.isNodeOf);
        if (isNodeOfId) {
          parsed.isNodeOfId = isNodeOfId;
        }

        if (
          isNodeOfId &&
          (isNodeOfId.startsWith('graph:') ||
            isNodeOfId.startsWith('journal:') ||
            isNodeOfId.startsWith('user:') ||
            isNodeOfId.startsWith('org:'))
        ) {
          parsed.graphId = isNodeOfId;
        }

        if (isNodeOfId.startsWith('issue:')) {
          parsed.issueId = isNodeOfId;
        }
      }
    }

    if (encoding.isNodeOf) {
      const isNodeOfId = getId(encoding.isNodeOf);
      if (isNodeOfId) {
        parsed.isNodeOfId = isNodeOfId;
      }

      if (
        isNodeOfId &&
        (isNodeOfId.startsWith('graph:') ||
          isNodeOfId.startsWith('journal:') ||
          isNodeOfId.startsWith('user:') ||
          isNodeOfId.startsWith('org:'))
      ) {
        parsed.graphId = isNodeOfId;
      }

      if (isNodeOfId.startsWith('issue:')) {
        parsed.issueId = isNodeOfId;
      }
    }

    if (!parsed.graphId && parsed.issueId) {
      parsed.graphId = `journal:${unprefix(parsed.issueId).split('/')[0]}`;
    }

    params = Object.assign(
      // default
      {
        creator: `bot:${this.constructor.name}`
      },
      // default extracted from encoding
      Object.keys(apiParams).reduce((params, p) => {
        if (p in encoding) {
          params[apiParams[p]] = encoding[p];
        }
        return params;
      }, {}),
      // overwrite parameters (will overwrite what was extracted from encoding (if anything))
      params,
      // overwrite resourceId, encodingId, isNodeOfId extracted from params.encodesCreativeWork
      parsed
    );

    // add contentUrl
    if (!params.contentUrl && params.encodingId) {
      params.contentUrl = `${this.API_PATHNAME_PREFIX}${unprefix(
        params.encodingId
      )}`;
    }

    // remove version qs (if any)
    if (params.graphId) {
      params.graphId = params.graphId.split('?')[0];
    }

    return params;
  }

  createEncoding(params, metadata = {}) {
    const encoding = {
      dateCreated: params.dateCreated || new Date().toISOString()
    };
    if (params.encodingId) {
      encoding['@id'] = params.encodingId;
    }
    if (params['@type']) {
      encoding['@type'] = params['@type'];
    }
    if (params.creator) {
      encoding.creator = params.creator;
    }
    if (params.fileFormat) {
      encoding.fileFormat = params.fileFormat;
    }
    if (metadata.size != null) {
      encoding.contentSize = metadata.size;
    }
    if (params.name != null) {
      encoding.name = params.name;
    }
    if (params.contentUrl != null) {
      encoding.contentUrl = params.contentUrl;
    }
    if (metadata.sha) {
      encoding.contentChecksum = {
        '@type': 'Checksum',
        checksumAlgorithm: 'sha256',
        checksumValue: metadata.sha
      };
    }

    //handle pass through props
    ['encodesCreativeWork', 'isBasedOn', 'isNodeOf'].forEach(p => {
      if (params[p]) {
        encoding[p] = params[p];
      }
    });

    if (!getId(encoding.isNodeOf) && params.isNodeOfId) {
      encoding.isNodeOf = params.isNodeOfId;
    }

    if (metadata.compressed) {
      const compressedEncoding = {
        '@type': 'MediaObject'
      };
      if (metadata.compressed.size != null) {
        compressedEncoding.contentSize = metadata.compressed.size;
      }
      if (metadata.compressed.encodingFormat != null) {
        compressedEncoding.encodingFormat = metadata.compressed.encodingFormat;
      }
      if (metadata.compressed.sha != null) {
        compressedEncoding.contentChecksum = {
          '@type': 'Checksum',
          checksumAlgorithm: 'sha256',
          checksumValue: metadata.compressed.sha
        };
      }
      encoding.encoding = compressedEncoding;
    }

    return encoding;
  }

  put(encoding, params, callback) {
    if (arguments.length === 2 && typeof arguments[1] === 'function') {
      callback = params;
      params = {};
    }

    try {
      params = this.getParams(encoding, params);
    } catch (e) {
      return callback(e);
    }

    const missing = [
      'graphId',
      'resourceId',
      'encodingId',
      'contentUrl',
      'creator'
    ].filter(p => params[p] == null);
    if (missing.length) {
      return callback(new Error(`missing params ${missing.join(', ')}`));
    }

    if (!params.fileFormat) {
      params.fileFormat =
        (params.path && mime.lookup(params.path)) || 'application/octet-stream';
    }

    // Some store (CouchDB for instance do require a contentSize) so we compute it when it's not costly
    if (
      params.body &&
      (typeof params.body == 'string' ||
        params.body instanceof String ||
        Buffer.isBuffer(params.body))
    ) {
      params.contentSize = Buffer.isBuffer(params.body)
        ? params.body.length
        : Buffer.byteLength(params.body);
    }

    if (!params.name && params.path) {
      params.name = path.basename(params.path);
    }

    let writeStream = this.store.createWriteStream(params, (err, metadata) => {
      if (err) return callback(err);

      const encoding = this.createEncoding(params, metadata);

      callback(null, encoding, {
        graphId: params.graphId,
        resourceId: params.resourceId,
        encodingId: params.encodingId
      });
    });

    if (params.body) {
      if (
        typeof params.body == 'string' ||
        params.body instanceof String ||
        Buffer.isBuffer(params.body)
      ) {
        writeStream.end(params.body);
        return writeStream;
      } else {
        return params.body.pipe(writeStream);
      }
    } else if (params.path) {
      return fs.createReadStream(params.path).pipe(writeStream);
    } else {
      return writeStream;
    }
  }

  get(encoding, params, callback) {
    if (arguments.length === 2 && typeof arguments[1] === 'function') {
      callback = params;
      params = {};
    }

    try {
      params = this.getParams(encoding, Object.assign({}, params));
    } catch (e) {
      return callback(e);
    }

    const missing = ['graphId', 'resourceId', 'encodingId'].filter(
      p => params[p] == null || params[p] == ''
    );
    if (missing.length) {
      const error = new Error(`missing params ${missing.join(', ')}`);
      if (callback) {
        return callback(error);
      } else {
        return new Readable({
          read(size) {
            process.nextTick(() => this.emit('error', error));
            return;
          }
        });
      }
    }

    let readStream = this.store.createReadStream(params);
    if (missing.length) {
      readStream.emit(
        'error',
        new Error(`missing params ${missing.join(', ')}`)
      );
    }

    if (callback) {
      callback = once(callback);
      readStream.on('error', callback);
      readStream.pipe(
        concat(data => {
          callback(null, data);
        })
      );
    } else {
      return readStream;
    }
  }

  delete(encoding, params, callback) {
    if (!callback) {
      callback = params;
      params = {};
    }
    try {
      params = this.getParams(encoding, params);
    } catch (e) {
      return callback(e);
    }

    const missing = ['graphId', 'resourceId', 'encodingId'].filter(p => {
      return !(p in params); // !! null are valid values
    });
    if (missing.length) {
      return callback(
        new Error(`missing params ${missing.join(', ')} (can be null)`)
      );
    }

    this.store.remove(params, (err, metadata) => {
      if (err) return callback(err);
      metadata = Array.isArray(metadata) ? metadata : [metadata];
      callback(
        null,
        metadata.map(d => {
          return {
            '@type': 'DeleteAction',
            actionStatus: 'CompletedActionStatus',
            object: {
              '@id': d.encodingId,
              encodesCreativeWork: d.resourceId
            },
            instrument: d.graphId
          };
        }),
        metadata
      );
    });
  }
}
