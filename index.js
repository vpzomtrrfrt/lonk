var http = require('http');
var pg = require('pg');

var db = new pg.Client(process.env.DATABASE_URL);
db.connect(function(err) {
	if(err) {
		console.error(err);
		process.exit();
	}
});

var PORT = process.env.PORT || 5555;

var die = function(res, err, data, type) {
	if(!type) type = "text/plain";
	res.writeHead(err, {"Content-type": type});
	res.write(data);
	res.end();
};

http.createServer(function(req, res) {
	console.log(req.url);
	if(req.url === "/") {
		die(res, 200, "hi");
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
