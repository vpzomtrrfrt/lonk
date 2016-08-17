var http = require('http');
var pg = require('pg');
var querystring = require('querystring');

var db = new pg.Client(process.env.DATABASE_URL);
db.connect(function(err) {
	if(err) {
		console.error(err);
		process.exit();
	}
});

var PORT = process.env.PORT || 5555;

var ALLOWED_CHARS = charsFrom('a', 'z')+charsFrom('A', 'Z')+charsFrom('0', '9')+"-_.";

var die = function(res, err, data, type) {
	if(!type) type = "text/plain";
	res.writeHead(err, {"Content-type": type});
	res.write(data+"");
	res.end();
};

var mergeInto = function(target, source) {
	for(var k in source) {
		target[k] = source[k];
	}
};

var getFields = function(req, callback) {
	var url = req.url;
	var params = {};
	var ind = url.indexOf("?");
	if(ind > -1) {
		mergeInto(params, querystring.parse(url.substring(ind+1)));
		url = url.substring(0, ind);
	}
	if(req.method === "POST") {
		var body = '';
		req.on('data', function(data) {
			body += data;
			if(body.length > 1e6) {
				req.connection.destroy();
			}
		});
		req.on('end', function() {
			mergeInto(params, querystring.parse(body));
			callback(null, params, url);
		});
	}
	else {
		callback(null, params, url);
	}
};

function charsFrom(start, end) {
	var tr = "";
	var startIndex = start.charCodeAt(0);
	var endIndex = end.charCodeAt(0);
	if(endIndex < startIndex) {
		console.warn("charsFrom doesn't work like that");
		return tr;
	}
	for(var i = startIndex; i < endIndex+1; i++) {
		tr += String.fromCharCode(i);
	}
	return tr;
}

var attemptCreate = function(url, id, random, callback) {
	if(arguments.length === 3) {
		callback = random;
		attemptCreate(url, id, false, callback);
		return;
	}
	for(var i = 0; i < id.length; i++) {
		if(ALLOWED_CHARS.indexOf(id[i]) === -1) {
			callback("'"+id[i]+"' is not an allowed character");
			return;
		}
	}
	db.query("INSERT INTO links (url, id, random) VALUES ($1, $2, $3)", [url, id, !!random], function(err, result) {
		if(err) {
			if(err.code === "23505") {
				callback("Already taken");
				return;
			}
			console.log(err);
			callback(err);
		}
		else {
			callback(null, id);
		}
	});
};

var randomString = function(length) {
	var tr = "";
	for(var i = 0; i < length; i++) {
		tr += ALLOWED_CHARS[Math.floor(Math.random()*ALLOWED_CHARS.length)];
	}
	return tr;
};

var attemptCreateRandom = function(url, length, triesLeft, callback) {
	if(arguments.length === 2) {
		callback = length;
		db.query("SELECT * FROM links WHERE url=$1 AND random=true", [url], function(err, result) {
			if(err) {
				die(res, 500, err);
				return;
			}
			if(result.rows.length === 0) {
				attemptCreateRandom(url, 1, callback);
			}
			else {
				callback(null, result.rows[0].id);
			}
		});
		return;
	}
	if(arguments.length === 3) {
		callback = triesLeft;
		attemptCreateRandom(url, length, Math.pow(ALLOWED_CHARS.length, length-1), callback);
		return;
	}
	var str = randomString(length);
	attemptCreate(url, str, true, function(err, result) {
		if(err) {
			if(err != "Already taken") {
				callback(err);
				return;
			}
			// try again
			if(triesLeft > 1) {
				attemptCreateRandom(url, length, triesLeft-1, callback);
			}
			else {
				attemptCreateRandom(url, length+1, callback);
			}
			return;
		}
		callback(result);
	});
};

http.createServer(function(req, res) {
	console.log(req.url);
	if(req.url === "/") {
		die(res, 200, "hi");
	}
	else if(req.url.indexOf('/api') === 0) {
		getFields(req, function(err, fields, url) {
			if(url === "/api/create") {
				if(!("url" in fields)) {
					die(res, 400, "URL missing");
					return;
				}
				if(fields.custom) {
					attemptCreate(fields.url, fields.custom, function(err, result) {
						if(err) {
							die(res, 400, err);
							return;
						}
						die(res, 200, result);
					});
				}
				else {
					attemptCreateRandom(fields.url, function(err, result) {
						if(err) {
							die(res, 500, err);
							return;
						}
						die(res, 200, result);
					});
				}
			}
			else {
				die(res, 404, "API call not found.");
			}
		});
	}
	else {
		var id = req.url.substring(1);
		db.query("SELECT * FROM links WHERE id=$1", [id], function(err, result) {
			if(err) {
				die(res, 500, "Internal Server Error");
				console.error(err);
				return;
			}
			if(result.rows.length < 1) {
				die(res, 404, "Couldn't find that link.");
				return;
			}
			var url = result.rows[0].url;
			res.writeHead(301, {"Content-type": "text/html", "Location": url});
			res.write('<html><head><title>Lonk</title></head><body><a href="'+url+'">Click here to continue</a></body></html>');
			res.end();
		});
	}
}).listen(PORT);
