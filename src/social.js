var plugins = require('./plugins');
var db = require('./database');
var async = require('async');

var social = module.exports;

social.postSharing = null;

social.getPostSharing = (callback) => {
	if (social.postSharing) {
		return callback(null, social.postSharing);
	}

	var networks = [
		{
			id: 'facebook',
			name: 'Facebook',
			class: 'fa-facebook',
		},
		{
			id: 'twitter',
			name: 'Twitter',
			class: 'fa-twitter',
		},
		{
			id: 'google',
			name: 'Google+',
			class: 'fa-google-plus',
		},
	];

	async.waterfall([
		(next) => {
			plugins.fireHook('filter:social.posts', networks, next);
		},
		(networks, next) => {
			db.getSetMembers('social:posts.activated', next);
		},
		(activated, next) => {
			networks.forEach((network, i) => {
				networks[i].activated = (activated.indexOf(network.id) !== -1);
			});

			social.postSharing = networks;
			next(null, networks);
		},
	], callback);
};

social.getActivePostSharing = (callback) => {
	async.waterfall([
		(next) => {
			social.getPostSharing(next);
		},
		(networks, next) => {
			networks = networks.filter(network => network && network.activated);
			next(null, networks);
		},
	], callback);
};

social.setActivePostSharingNetworks = (networkIDs, callback) => {
	async.waterfall([
		(next) => {
			db.delete('social:posts.activated', next);
		},
		(next) => {
			if (!networkIDs.length) {
				return next();
			}
			db.setAdd('social:posts.activated', networkIDs, next);
		},
		(next) => {
			social.postSharing = null;
			next();
		},
	], callback);
};
