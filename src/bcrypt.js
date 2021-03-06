var bcrypt = require('bcryptjs');
var async = require('async');


process.on('message', (msg) => {
	if (msg.type === 'hash') {
		hashPassword(msg.password, msg.rounds);
	} else if (msg.type === 'compare') {
		bcrypt.compare(String(msg.password || ''), String(msg.hash || ''), done);
	}
});

function hashPassword(password, rounds) {
	async.waterfall([
		(next) => {
			bcrypt.genSalt(parseInt(rounds, 10), next);
		},
		(salt, next) => {
			bcrypt.hash(password, salt, next);
		},
	], done);
}

function done(err, result) {
	if (err) {
		process.send({ err: err.message });
		return process.disconnect();
	}
	process.send({ result: result });
	process.disconnect();
}
