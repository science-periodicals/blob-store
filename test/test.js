import assert from 'assert';
import crypto from 'crypto';
import uuid from 'uuid';
import fs from 'fs';
import path from 'path';
import concat from 'concat-stream';
import asyncEach from 'async/each';
import { unprefix } from '@scipe/jsonld';
import BlobStore from '../src';

const config = {
  curiePrefix: 'prefix',
  apiPathnamePrefix: '/encoding/'
};

function createNodeId() {
  return `node:${uuid.v4()}`;
}

function createGraphId() {
  return `graph:${uuid.v4()}`;
}

describe('BlobStore', function() {
  this.timeout(20000);

  describe('BlobStore#getParams', function() {
    const store = new BlobStore(config);

    it('should extract API parameters from a Graph encoding', function() {
      const encoding = {
        '@id': '_:encodingId',
        '@type': 'ImageObject',
        fileFormat: 'image/jpeg',
        encodesCreativeWork: {
          '@id': 'node:resourceId',
          isNodeOf: 'graph:graphId'
        }
      };

      const params = store.getParams(encoding);

      assert.equal(params.graphId, 'graph:graphId');
      assert.equal(params.resourceId, 'node:resourceId');
      assert.equal(params.encodingId, '_:encodingId');
      assert.equal(params['@type'], 'ImageObject');
      assert(params.contentUrl);
    });

    it('should extract API parameters from a journal Style encoding', function() {
      const encoding = {
        '@id': 'node:encodingId',
        '@type': 'ImageObject',
        fileFormat: 'image/jpeg',
        encodesCreativeWork: {
          '@id': 'node:styleId',
          isNodeOf: 'journal:periodicalId'
        }
      };

      const params = store.getParams(encoding);

      assert.equal(params.graphId, 'journal:periodicalId');
      assert.equal(params.resourceId, 'node:styleId');
      assert.equal(params.encodingId, 'node:encodingId');
      assert.equal(params['@type'], 'ImageObject');
      assert(params.contentUrl);
    });

    it('should extract API parameters from am issue Style encoding', function() {
      const encoding = {
        '@id': 'node:encodingId',
        '@type': 'ImageObject',
        fileFormat: 'image/jpeg',
        encodesCreativeWork: {
          '@id': 'node:styleId',
          isNodeOf: 'issue:periodicalId/0'
        }
      };

      const params = store.getParams(encoding);

      assert.equal(params.graphId, 'journal:periodicalId');
      assert.equal(params.resourceId, 'node:styleId');
      assert.equal(params.encodingId, 'node:encodingId');
      assert.equal(params['@type'], 'ImageObject');
      assert(params.contentUrl);
    });

    it('should extract API parameters from a logo encoding', function() {
      const encoding = {
        '@id': 'node:encodingId',
        '@type': 'ImageObject',
        fileFormat: 'image/jpeg',
        encodesCreativeWork: {
          '@id': 'node:resourceId',
          isNodeOf: 'journal:periodicalId'
        }
      };

      const params = store.getParams(encoding);

      assert.equal(params.graphId, 'journal:periodicalId');
      assert.equal(params.resourceId, 'node:resourceId');
      assert.equal(params.encodingId, 'node:encodingId');
      assert.equal(params['@type'], 'ImageObject');
      assert(params.contentUrl);
    });

    it('should extract API parameters from a service logo encoding', function() {
      const encoding = {
        '@id': 'node:encodingId',
        '@type': 'ImageObject',
        fileFormat: 'image/jpeg',
        encodesCreativeWork: {
          '@id': 'node:resourceId',
          isNodeOf: 'service:serviceId'
        }
      };

      const params = store.getParams(encoding, { graphId: 'org:orgId' });

      assert.equal(params.graphId, 'org:orgId');
      assert.equal(params.resourceId, 'node:resourceId');
      assert.equal(params.encodingId, 'node:encodingId');
      assert.equal(params['@type'], 'ImageObject');
      assert(params.contentUrl);
    });

    it('should extract API parameters from a publication type logo encoding', function() {
      const encoding = {
        '@id': 'node:encodingId',
        '@type': 'ImageObject',
        fileFormat: 'image/jpeg',
        encodesCreativeWork: {
          '@id': 'node:resourceId',
          isNodeOf: 'type:typeId'
        }
      };

      const params = store.getParams(encoding, {
        graphId: 'journal:journalId'
      });

      assert.equal(params.graphId, 'journal:journalId');
      assert.equal(params.resourceId, 'node:resourceId');
      assert.equal(params.encodingId, 'node:encodingId');
      assert.equal(params['@type'], 'ImageObject');
      assert(params.contentUrl);
    });
  });

  describe('BlobStore#put, BlobStore#get', function() {
    describe('non compressible blobs', function() {
      const graphId = createGraphId();
      const resourceId = createNodeId();
      const sourcePath = path.join(__dirname, 'fixtures', 'pieuvre.png');

      let buffer, expected;

      before(function(done) {
        fs.stat(sourcePath, function(err, stats) {
          fs.readFile(sourcePath, function(err, data) {
            var encodingId = createNodeId();
            expected = {
              '@id': encodingId,
              '@type': 'ImageObject',
              creator: 'bot:BlobStore',
              fileFormat: 'image/png',
              contentSize: stats.size,
              name: 'pieuvre.png',
              contentUrl: '/encoding/' + unprefix(encodingId),
              encodesCreativeWork: resourceId,
              //dateCreated: '2015-04-17T15:37:00.528Z',
              contentChecksum: {
                '@type': 'Checksum',
                checksumAlgorithm: 'sha256',
                checksumValue: 'DmjKGM5ZHmyeDdVxUpoCADhybkfISowriovdhgbXVBA='
              }
            };

            buffer = data;
            done();
          });
        });
      });

      ['S3', 'fs'].forEach(storeType => {
        describe(storeType, function() {
          var store, encoding;
          before(function(done) {
            store = new BlobStore(
              Object.assign({ blobStorageBackend: storeType }, config)
            );
            store.put(
              {
                body: fs.createReadStream(sourcePath),
                graphId,
                resourceId,
                encodingId: expected['@id'],
                name: expected.name,
                fileFormat: expected.fileFormat,
                '@type': expected['@type'],
                contentSize: expected.contentSize,
                encodesCreativeWork: resourceId
              },
              function(err, _encoding) {
                if (err) throw err;
                encoding = _encoding;
                done();
              }
            );
          });

          it('should have put the blob and produce a schema.org compliant encoding object', function() {
            delete encoding.dateCreated;
            assert.deepEqual(encoding, expected);
          });

          it('should get the blob as a Buffer', function(done) {
            store.get(
              { graphId, resourceId, encodingId: expected['@id'] },
              function(err, body) {
                if (err) throw err;
                assert(Buffer.isBuffer(body));
                assert.equal(body.length, expected.contentSize);
                done();
              }
            );
          });

          it('should get the blob as a stream', function(done) {
            store
              .get({ graphId, resourceId, encodingId: expected['@id'] })
              .pipe(
                concat(function(body) {
                  assert(Buffer.isBuffer(body));
                  assert.equal(body.length, expected.contentSize);
                  done();
                })
              );
          });

          it('should support start-end ranges', function(done) {
            store
              .get({
                graphId,
                resourceId,
                encodingId: expected['@id'],
                range: [100, 199]
              })
              .pipe(
                concat(function(body) {
                  assert(Buffer.isBuffer(body));
                  assert.equal(body.length, 100);
                  done();
                })
              );
          });

          it('should support start-* ranges', function(done) {
            store
              .get({
                graphId,
                resourceId,
                encodingId: expected['@id'],
                range: [1000]
              })
              .pipe(
                concat(function(body) {
                  assert(Buffer.isBuffer(body));
                  assert.equal(body.length, expected.contentSize - 1000);
                  done();
                })
              );
          });

          it('should support ranges that start at 0', function(done) {
            store
              .get({
                graphId,
                resourceId,
                encodingId: expected['@id'],
                range: [0, 1]
              })
              .pipe(
                concat(function(body) {
                  assert(Buffer.isBuffer(body));
                  assert.equal(body.length, 2);
                  done();
                })
              );
          });

          it('should put the blob when given as a buffer', function(done) {
            store.put(
              {
                body: buffer,
                graphId,
                resourceId,
                encodingId: expected['@id']
              },
              (err, encoding) => {
                assert.deepEqual(
                  encoding.contentChecksum,
                  expected.contentChecksum
                );
                done();
              }
            );
          });

          after(function(done) {
            store.delete(
              { graphId, resourceId: null, encodingId: null },
              function(err, info) {
                done();
              }
            );
          });
        });
      });
    });

    describe('compressible blobs', function() {
      const graphId = createGraphId();
      const resourceId = createNodeId();
      const sourcePath = path.join(
        path.dirname(__filename),
        'fixtures',
        'data.csv'
      );

      var expected;
      before(function(done) {
        fs.stat(sourcePath, function(err, stats) {
          var encodingId = createNodeId();
          expected = {
            '@id': encodingId,
            '@type': 'DataDownload',
            creator: 'bot:BlobStore',
            fileFormat: 'text/csv',
            contentSize: stats.size,
            name: 'data.csv',
            contentUrl: '/encoding/' + unprefix(encodingId),
            encodesCreativeWork: resourceId,
            // dateCreated: '2016-02-24T00:13:40.479Z',
            contentChecksum: {
              '@type': 'Checksum',
              checksumAlgorithm: 'sha256',
              checksumValue: 'WdBinDdm8tAJ5WaYDaMdQNXZVKHa9SX/0asVDa0wj2I='
            },
            encoding: {
              '@type': 'MediaObject',
              contentSize: 27742,
              encodingFormat: 'gzip',
              contentChecksum: {
                '@type': 'Checksum',
                checksumAlgorithm: 'sha256'
                // checksumValue: '8USGVWJEgAVo8jVP9RLVp+2NoCJNqXt9hf82W9ySuCs='
              }
            }
          };
          done();
        });
      });

      ['S3', 'fs'].forEach(storeType => {
        describe(storeType, function() {
          var store, encoding;
          before(function(done) {
            store = new BlobStore(
              Object.assign({ blobStorageBackend: storeType }, config)
            );
            store.put(
              {
                body: fs.createReadStream(sourcePath),
                graphId,
                resourceId,
                encodingId: expected['@id'],
                name: expected.name,
                type: 'DataDownload',
                fileFormat: expected.fileFormat,
                contentSize: expected.contentSize,
                encodesCreativeWork: resourceId
              },
              function(err, _encoding) {
                if (err) throw err;
                encoding = _encoding;
                done();
              }
            );
          });

          it('should have put the blob and produced a schema.org compliant encoding object', function() {
            delete encoding.dateCreated;
            delete encoding.encoding.contentChecksum.checksumValue;
            // console.log(require('util').inspect(encoding, { depth: null }));
            assert.deepEqual(encoding, expected);
          });

          it('should get the (compressed) blob as a Buffer', function(done) {
            store.get(
              { graphId, resourceId, encodingId: expected['@id'] },
              { decompress: false },
              function(err, body) {
                assert(Buffer.isBuffer(body));
                assert.equal(body.length, expected.encoding.contentSize);
                done();
              }
            );
          });

          it('should get the blob as a Buffer with decompress option', function(done) {
            store.get(
              { graphId, resourceId, encodingId: expected['@id'] },
              { decompress: true },
              function(err, body) {
                assert(Buffer.isBuffer(body));
                assert.equal(body.length, expected.contentSize);
                done();
              }
            );
          });

          it('should get the (decompressed) blob as a stream', function(done) {
            store
              .get(
                { graphId, resourceId, encodingId: expected['@id'] },
                { decompress: true }
              )
              .pipe(
                concat(function(body) {
                  assert(Buffer.isBuffer(body));
                  assert.equal(body.length, expected.contentSize);
                  const sha = crypto
                    .createHash('sha256')
                    .update(body)
                    .digest('base64');
                  assert.equal(sha, encoding.contentChecksum.checksumValue);
                  done();
                })
              );
          });

          after(function(done) {
            store.delete(
              { graphId, resourceId: null, encodingId: null },
              function(err, info) {
                done();
              }
            );
          });
        });
      });
    });
  });

  describe('BlobStore#delete', function() {
    ['S3', 'fs'].forEach(storeType => {
      describe(storeType, function() {
        let store = new BlobStore(
          Object.assign({ blobStorageBackend: storeType }, config)
        );
        const graphId = createGraphId();
        const resourceId = createNodeId();
        const encodingId = createNodeId();
        let blobs;

        beforeEach(function(done) {
          const sourcePath = path.join(
            path.dirname(__filename),
            'fixtures',
            'pieuvre.png'
          );
          fs.stat(sourcePath, function(err, stats) {
            blobs = [
              { graphId, resourceId, encodingId },
              { graphId, resourceId, encodingId: `other-${encodingId}` },
              {
                graphId: `other-${graphId}`,
                resourceId: `other-${resourceId}`,
                encodingId: `other-${encodingId}`
              }
            ].map(blob => {
              return Object.assign(
                {
                  name: path.basename(sourcePath),
                  contentSize: stats.size,
                  fileFormat: 'image/png'
                },
                blob
              );
            });

            asyncEach(
              blobs,
              (blob, cb) => {
                fs.createReadStream(sourcePath).pipe(store.put(blob, cb));
              },
              done
            );
          });
        });

        it('should delete a blob', function(done) {
          store.delete({ graphId, resourceId, encodingId }, function(
            err,
            action,
            params
          ) {
            assert.deepEqual(params, [{ graphId, resourceId, encodingId }]);
            done();
          });
        });

        it('should delete all the blobs of a resource', function(done) {
          store.delete({ graphId, resourceId, encodingId: null }, function(
            err,
            action,
            params
          ) {
            assert.deepEqual(
              params.sort((a, b) => a.encodingId.localeCompare(b.encodingId)),
              [
                { graphId, resourceId, encodingId },
                { graphId, resourceId, encodingId: `other-${encodingId}` }
              ].sort((a, b) => a.encodingId.localeCompare(b.encodingId))
            );
            done();
          });
        });

        it('should delete all the blobs of a bundle', function(done) {
          store.delete(
            { graphId, resourceId: null, encodingId: null },
            function(err, action, params) {
              assert.deepEqual(
                params.sort((a, b) => a.encodingId.localeCompare(b.encodingId)),
                [
                  { graphId, resourceId, encodingId },
                  { graphId, resourceId, encodingId: `other-${encodingId}` }
                ].sort((a, b) => a.encodingId.localeCompare(b.encodingId))
              );
              done();
            }
          );
        });

        it('should not error when ask to delete blobs that do not exists', function(done) {
          store.delete(
            {
              graphId: createGraphId(),
              resourceId: createNodeId(),
              encodingId: createNodeId()
            },
            function(err, action, params) {
              assert(!err);
              done();
            }
          );
        });

        it('should not error when ask to delete blobs that do not exists with a range query', function(done) {
          store.delete(
            {
              graphId: createGraphId(),
              resourceId: null,
              encodingId: null
            },
            function(err, action, params) {
              assert(!err);
              assert.deepEqual(params, []);
              done();
            }
          );
        });

        afterEach(function(done) {
          asyncEach(
            blobs,
            (blob, cb) => {
              store.delete(blob, cb);
            },
            done
          );
        });
      });
    });
  });
});
