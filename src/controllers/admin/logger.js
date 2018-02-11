

var loggerController = module.exports;

loggerController.get = (req, res) => {
	res.render('admin/development/logger', {});
};
