# @scipe/blob-store

[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

Note: this module is auto published to npm on CircleCI. Only run `npm version
patch|minor|major` and let CI do the rest.

sci.pe blob store powered by
the [abstract-blob-store](https://github.com/maxogden/abstract-blob-store) API
with a zest of [schema.org](http://schema.org).


## API `BlobStore(config)`

```js
import BlobStore from '@scipe/blob-store';

let store = new BlobStore({
  store: 'S3', // or 'fs'
  apiPathnamePrefix: 'http://example.com/'
});
```

### `BlobStore#put(encoding[, params] [, callback])`

```js
store.put({
  body: fs.createReadStream('pieuvre.png'), // body can also be a string or a Buffer
  graphId: 'graphId',
  resourceId: 'resourceId',
  encodingId: 'encodingId'
}, (err, encoding, params) => {
  console.log(encoding);
});
```

or

```js
store.put({
  path: 'pieuvre.png',
  graphId: 'graphId',
  resourceId: 'resourceId',
  encodingId: 'encodingId'
}, (err, encoding, params) => {
  console.log(encoding);
});
```

or

```js
let readStream = fs.createReadStream('data.csv');
let writeStream = store.put({
  graphId: 'graphId',
  resourceId: 'resourceId',
  encodingId: 'encodingId'
}, (err, encoding, params) => {
  console.log(encoding);
});

readStream.pipe(writeStream);
```

`encoding` is a schema.org [MediaObject](http://schema.org/MediaObject) or subclass thereof e.g.,

```js
{
  '@id': 'encodingId',
  '@type': 'ImageObject',
  creator: 'bot:BlobStore',
  fileFormat: 'image/png',
  contentSize: 20402,
  name: 'pieuvre.png',
  contentUrl: 'http://example.com/encodingId',
  encodesCreativeWork: 'resourceId',
  dateCreated: '2015-04-17T15:37:00.528Z',
  contentChecksum: {
    '@type': 'Checksum',
    checksumAlgorithm: 'sha256',
    checksumValue: 'DmjKGM5ZHmyeDdVxUpoCADhybkfISowriovdhgbXVBA='
  }
}
```

An `encoding` (schema.org [MediaObject](http://schema.org/MediaObject)
or subclass thereof) can be passed as the first paramater and `params`
used to overwrite parameters (`graphId`, `resourceId`, `encodingId`)
that can be extracted from the encoding.


### `BlobStore#get(encoding[, params] [, callback])`

```js
let readStream = store.get({
  graphId: 'graphId',
  resourceId: 'resourceId',
  encodingId: 'encodingId'
});
```

or

```js
store.get({
  graphId: 'graphId',
  resourceId: 'resourceId',
  encodingId: 'encodingId'
}, (err, body) => {
  // body is a Buffer
});
```

### `BlobStore#delete(encoding[, params], callback)`

Delete a blob:

```js
store.delete({
  graphId: 'graphId',
  resourceId: 'resourceId',
  encodingId: 'encodingId'
}, (err, action, params) => {

});
```

Delete all the blobs of a resource:

```js
store.delete({
  graphId: 'graphId',
  resourceId: 'resourceId',
  encodingId: null
}, (err, action, params) => {

});
```

Delete all the blobs of a graph:

```js
store.delete({
  graphId: 'graphId',
  resourceId: null,
  encodingId: null
}, (err, action, params) => {

});
```

## License

`@scipe/blob-store` is dual-licensed under commercial and open source licenses
([AGPLv3](https://www.gnu.org/licenses/agpl-3.0.en.html)) based on the intended
use case. Contact us to learn which license applies to your use case.
