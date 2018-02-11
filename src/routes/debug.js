var express = require('express');
var nconf = require('nconf');

module.exports = (app) => {
	var router = express.Router();

	router.get('/test', (req, res) => {
		res.redirect(404);
	});

	app.use(nconf.get('relative_path') + '/debug', router);
};
