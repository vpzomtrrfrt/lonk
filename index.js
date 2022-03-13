var http = require('http');
var pg = require('pg');
var querystring = require('querystring');
var fs = require('fs');
var multiparty = require('multiparty');

var db = new pg.Client(process.env.DATABASE_URL);
db.connect(function(err) {
	if(err) {
		console.error(err);
		process.exit();
	}
});

var PORT = process.env.PORT || 5555;

var ALLOWED_CHARS = charsFrom('a', 'z')+charsFrom('A', 'Z')+charsFrom('0', '9')+"-_.";
var RESERVED_IDS = ["api", "about"];

var die = function(res, err, data, type) {
	if(!type) type = "text/plain";
	if(!data) {
		if(err === 500) data = "Internal Server Error";
		else if(err === 404) data = "404 Not Found";
		else data = "Error "+err;
	}
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
		if("content-type" in req.headers && req.headers["content-type"].indexOf("multipart/form-data") === 0) {
			// form-data
			var form = new multiparty.Form();
			form.parse(req, function(err, fields, files) {
				for(var k in fields) {
					params[k] = fields[k][0];
				}
				callback(null, params, url);
			});
		}
		else {
			// x-www-form-urlencoded
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

var attemptCreate = function(domain, url, id, random, callback) {
	if(arguments.length === 4) {
		callback = random;
		attemptCreate(domain, url, id, false, callback);
		return;
	}
	if(RESERVED_IDS.indexOf(id) > -1) {
		callback("Already taken");
	}
	for(var i = 0; i < id.length; i++) {
		if(ALLOWED_CHARS.indexOf(id[i]) === -1) {
			callback("'"+id[i]+"' is not an allowed character");
			return;
		}
	}
	db.query("INSERT INTO links (domain, url, id, random) VALUES ($4, $1, $2, $3)", [url, id, !!random, domain], function(err, result) {
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

var attemptCreateRandom = function(domain, url, length, triesLeft, callback) {
	if(arguments.length === 3) {
		callback = length;
		db.query("SELECT * FROM links WHERE url=$1 AND random=true AND domain=$2", [url, domain], function(err, result) {
			if(err) {
				die(res, 500, err);
				return;
			}
			if(result.rows.length === 0) {
				attemptCreateRandom(domain, url, 5, callback);
			}
			else {
				callback(null, result.rows[0].id);
			}
		});
		return;
	}
	if(arguments.length === 4) {
		callback = triesLeft;
		attemptCreateRandom(domain, url, length, Math.pow(ALLOWED_CHARS.length, length-1), callback);
		return;
	}
	var str = randomString(length);
	attemptCreate(domain, url, str, true, function(err, result) {
		if(err) {
			if(err != "Already taken") {
				callback(err);
				return;
			}
			// try again
			if(triesLeft > 1) {
				attemptCreateRandom(domain, url, length, triesLeft-1, callback);
			}
			else {
				attemptCreateRandom(domain, url, length+1, callback);
			}
			return;
		}
		callback(null, result);
	});
};

http.createServer(function(req, res) {
	console.log(req.url);
	var domain = req.headers.host;
	if(domain.indexOf("www.") === 0) {
		domain = domain.substring(4);
	}
	console.log(domain);
	if(req.url === "/") {
		res.writeHead(200, {"Content-type": "text/html"});
		fs.readFile("static/index.html", function(err, content) {
			content = content.toString();
			var ex = /\{\{[A-Z_]*\}\}/;
			while(true) {
				var x = ex.exec(content);
				if(!x) break;
				var key = x[0].substring(2, x[0].length-2);
				var result = process.env[key];
				if(!result) result = "";
				content = content.substring(0, x.index)+result+content.substring(x.index+x[0].length);
			}
			res.write(content);
			res.end();
		});
	}
	else if(req.url.indexOf('/api') === 0) {
		getFields(req, function(err, fields, url) {
			if(url === "/api/create") {
				if(!("url" in fields)) {
					die(res, 400, "URL missing");
					return;
				}
				if(fields.custom) {
					attemptCreate(domain, fields.url, fields.custom, function(err, result) {
						if(err) {
							die(res, 400, err);
							return;
						}
						die(res, 200, result);
					});
				}
				else {
					attemptCreateRandom(domain, fields.url, function(err, result) {
						if(err) {
							die(res, 500, err);
							return;
						}
						die(res, 200, result);
					});
				}
			}
			else if(url === "/api/analytics") {
				if(!("id" in fields)) {
					die(res, 400, "ID missing");
					return;
				}
				var tr = {};
				tr.clicks = {};
				db.query("SELECT COUNT(*) AS clicks FROM visits WHERE id=$1 AND domain=$2", [fields.id, domain], function(err, result) {
					if(err) {
						die(res, 500);
						console.error(err);
						return;
					} 
					tr.clicks.total = parseInt(result.rows[0].clicks);
					die(res, 200, JSON.stringify(tr), "application/json");
				});
			}
			else {
				die(res, 404, "API call not found.");
			}
		});
	}
	else if(req.url.indexOf('/about') === 0) {
		if(req.url[req.url.length-1] === "+") {
			res.writeHead(200, {"Content-type": "text/html"});
			fs.createReadStream("static/analytics.html").pipe(res);
		}
		else {
			die(res, 404, "404 Not Found");
		}
	}
	else {
		var id = req.url.substring(1);
		var extra = "";
		for(var i = 0; i < id.length; i++) {
			if(ALLOWED_CHARS.indexOf(id[i]) === -1) {
				// pass it on
				extra = id.substring(i);
				id = id.substring(0, i);
				break;
			}
		}
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
			var success = false;
			for(var i = 0; i < result.rows.length; i++) {
				if(result.rows[i].domain === domain) {
					var ip = req.connection.remoteAddress;
					var fwd = req.headers["x-forwarded-for"];
					if(fwd) {
						ip = fwd.split(",")[0];
					}
					db.query("INSERT INTO visits (id, browser, ip, suffix, domain) VALUES ($1, $2, $3, $4, $5)", [id, req.headers["user-agent"], ip, extra, domain], function(err, result) {
						if(err) {
							console.error(err);
							return;
						}
					});
					var url = result.rows[0].url+extra;
					res.writeHead(301, {"Content-type": "text/html", "Location": url});
					res.write('<html><head><title>Lonk</title></head><body><a href="'+url+'">Click here to continue</a></body></html>');
					res.end();
					success = true;
					break;
				}
			}
			if(!success) {
				var tr = "<html><head><title>Link disambiguation</title></head><body>";
				tr += "Couldn't find that link.  Did you mean:<br/>";
				for(var i = 0; i < result.rows.length; i++) {
					var url = "http://"+result.rows[i].domain+"/"+id;
					tr += "<a href=\""+url+"\">"+url+"</a><br/>";
				}
				tr += "</body></html>";
				die(res, 404, tr, "text/html");
			}
		});
	}
}).listen(PORT);
