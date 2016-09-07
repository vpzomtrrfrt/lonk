'use strict';

var dbm;
var type;
var seed;

/**
  * We receive the dbmigrate dependency from dbmigrate initially.
  * This enables us to not have to rely on NODE_PATH.
  */
exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

var dropPKey = function(db, table, callback) {
  db.runSql("ALTER TABLE "+table+" DROP CONSTRAINT "+table+"_pkey", callback);
};

var newPKey = function(db, table, keys, callback) {
  db.runSql("ALTER TABLE "+table+" ADD PRIMARY KEY ("+keys.join(",")+")", callback);
};

var domainColumn = {
  type: "string",
  defaultValue: "lonk.pw",
  notNull: true
};

exports.up = function(db, callback) {
  dropPKey(db, "links", function() {
    db.addColumn("links", "domain", domainColumn, function() {
      newPKey(db, "links", ["id", "domain"], function() {
	db.addColumn("visits", "domain", domainColumn, function() {
	  callback();
	});
      });
    });
  });
};

exports.down = function(db, callback) {
  dropPKey(db, "links", function() {
    db.removeColumn("links", "domain", function() {
      newPKey(db, "links", ["id"], function() {
	db.removeColumn("visits", "domain", function() {
	  callback();
	});
      });
    });
  });
};
