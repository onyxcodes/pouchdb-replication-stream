'use strict';

var utils = require('./pouch-utils');
var Promise = require('pouchdb-promise');
var ERROR_REV_CONFLICT = {
  status: 409,
  name: 'conflict',
  message: 'Document update conflict'
};
var ndj = require('ndjson');
var ERROR_MISSING_DOC = {
  status: 404,
  name: 'not_found',
  message: 'missing'
};

const blobToBase64 = blob => {
  const reader = new FileReader();
  reader.readAsDataURL(blob);
  return new Promise(resolve => {
    reader.onloadend = () => {
      let res = reader.result.substr(reader.result.indexOf(',') + 1)
      resolve(res);
    };
  });
};

function WritableStreamPouch(opts, callback) {
  var api = this;
  api.instanceId = Math.random().toString();
  api.ndj = ndj.serialize();
  api.localStore = {};
  api.originalName = opts.name;

  // TODO: I would pass this in as a constructor opt, but
  // PouchDB changed how it clones in 5.0.0 so this broke
  api.setupStream = function (stream) {
    api.ndj.pipe(stream);
  };

  /* istanbul ignore next */
  api.type = function () {
    return 'writableStream';
  };

  api._id = utils.toPromise(function (callback) {
    callback(null, api.instanceId);
  });

  api._bulkDocs = utils.toPromise( async function (req, opts, callback) {
    var docs = req.docs;
    // console.log("Here are my docs",docs);
    var self = this;
    /* istanbul ignore else */
    if (opts.new_edits === false) {
      // assume we're only getting this with new_edits=false,
      // since this adapter is just a replication target
      // [TODO] Convert attachments from blob to base64

      await Promise.all(docs.map( async (doc) => {
        if (doc._attachments) {
          let docA = doc;
          // console.log(doc1._attachments)
          await Promise.all(Object.keys(docA._attachments).map( async attachName => {
            if (attachName) {
              let attachObj = docA._attachments[attachName]; 
              console.log(attachObj.data)
              await blobToBase64(attachObj.data).then( res => {
                console.log("Converted to base64",res)
                attachObj.data = res;
                docA._attachments[attachName] = attachObj;
              })
              return docA;
            }
          }))
        }
        return doc;
      })).then( res => {
        console.log("Found res",res);
        // console.log("Docs after fixing attachments",docs);
        this.ndj.write({docs: res}, function () {
          callback(null, docs.map(function (doc) {
            console.log("Found a doc while mapping through",doc);
            return {
              ok: true,
              id: doc._id,
              rev: doc._rev
            };
          }));
        });
      });
    } else {
      // writing local docs for replication
      Promise.all(docs.map(function (doc) {
        self.localStore[doc._id] = doc;
      })).then(function (res) {
        callback(null, res);
      }).catch(function (err) {
        callback(err);
      });
    }
  });

  api._getRevisionTree = function (docId, callback) {
    process.nextTick(function () {
      callback(ERROR_MISSING_DOC);
    });
  };

  api._close = function (callback) {
    this.ndj.end(callback);
  };

  api._getLocal = function (id, callback) {
    var self = this;
    process.nextTick(function () {
      var existingDoc = self.localStore[id];
      /* istanbul ignore else */
      if (existingDoc) {
        callback(null, existingDoc);
      } else {
        callback(ERROR_MISSING_DOC);
      }
    });
  };

  api._putLocal = function (doc, opts, callback) {
    var self = this;
    /* istanbul ignore else */
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    delete doc._revisions; // ignore this, trust the rev
    var oldRev = doc._rev;
    var id = doc._id;
    var newRev;
    if (!oldRev) {
      newRev = doc._rev = '0-1';
    } else {
      newRev = doc._rev = '0-' + (parseInt(oldRev.split('-')[1], 10) + 1);
    }

    process.nextTick(function () {
      var existingDoc = self.localStore[id];
      /* istanbul ignore if */
      if (existingDoc && oldRev !== existingDoc._rev) {
        callback(ERROR_REV_CONFLICT);
      } else {
        self.localStore[id] = doc;
        var done = function () {
          callback(null, {ok: true, id: id, rev: newRev});
        };
        /* istanbul ignore else */
        if ('last_seq' in doc) {
          self.ndj.write({seq: doc.last_seq}, done);
        } else {
          done();
        }
      }
    });
  };

  /* istanbul ignore next */
  api._removeLocal = function (doc, callback) {
    var self = this;
    process.nextTick(function () {
      var existingDoc = self.localStore[doc._id];
      if (existingDoc && doc._rev !== existingDoc._rev) {
        callback(ERROR_REV_CONFLICT);
      } else {
        delete self.localStore[doc._id];
        callback(null, {ok: true, id: doc._id, rev: '0-0'});
      }
    });
  };

  /* istanbul ignore next */
  api._destroy = function (opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    WritableStreamPouch.Changes.removeAllListeners(api.originalName);
    process.nextTick(function () {
      callback(null, {'ok': true});
    });
  };

  process.nextTick(function () {
    callback(null, api);
  });
}

WritableStreamPouch.valid = function () {
  return true;
};

module.exports = WritableStreamPouch;
