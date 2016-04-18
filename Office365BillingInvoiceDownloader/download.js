phantom.casperPath = 'node_modules/casperjs';
phantom.injectJs(phantom.casperPath + '/bin/bootstrap.js');

var casper = require('casper').create({
    verbose: true,
    logLevel: 'debug',
    pageSettings: {
        webSecurityEnabled: false,
        // IE 11 user agent, just in case ... :)
        userAgent: 'Mozilla/5.0 ;Windows NT 6.1; WOW64; Trident/7.0; rv:11.0; like Gecko',
    },
    // viewport size, useful for debugging with slimerjs engine
    viewportSize: {
        width: 1024,
        height: 768
    }
});
var utils = require('utils');

// timeout pro waitForSelector volani
var waitTimeout = 5000;

// load credentials from file that is not being tracked by Git
// credentials JSON file can be specified on the command line by using --credentials=filename.json, otherwise the default credentials.json will be used
var credentials = require(casper.cli.has('credentials') ? casper.cli.get('credentials') : 'credentials.json');
// settings - username and password of Microsoft Account that is the owner of the subscription
var userName = credentials.userName;
var password = credentials.password;

var dt = new Date();
var year = casper.cli.has('year') ? casper.cli.get('year') : dt.getFullYear();
var month = casper.cli.has('month') ? casper.cli.get('month') : dt.getMonth() + 1;

// start with URL that should display billing history of the subscription it should redirect to
//  login form (for Organizational Account, which seems to be the default variant of the login form)
//  because headless PhantomJS browser starts always with empty cache, no cookies, etc
casper.start(
    'https://portal.office.com/Commerce/BillOverview.aspx'
);
// TODO: try variant with this URL that leads directly to HTML frament containing the link to the invoice PDF
// 'https://portal.office.com/Commerce/BillDetailsContent.aspx?orderId=' + orderId + '&month=' + month + '&year=' + year

casper.then(function() {
    // fill login form with Organizational Account username and password
    this.fill('form', { 'login': userName, 'passwd': password }, true);
});

var mainFrameIframeId = 'will-be-detected';

casper.then(function() {

    this.waitForSelector('div#O365MainFrame', function() {

        this.echo("GOT MAINFRAME");

        // get IFRAMEs from the page to determine the right frame to use in this CasperJS script
        var items = this.evaluate(function() {
            var itemsInner = document.querySelectorAll('iframe');
            var itemsInnerProj = Array.prototype.map.call(itemsInner, function (item) {
                return {
                    tagName: item.tagName,
                    id: item.id,
                    className: item.className,
                    name: item.name
                };
            });
            return itemsInnerProj;
        });
        this.echo(JSON.stringify(items, null, 2));
        // will use id of the first IFRAME
        if (items.length > 0) mainFrameIframeId = items[0].id; else mainFrameIframeId = 'cf';
        this.echo('Will use this mainFrameIframeId: ' + mainFrameIframeId);

        this.withFrame(mainFrameIframeId, function() {

            this.echo("IN MAINFRAME");

            var items1 = this.evaluate(function() {
                var itemsInner = document.querySelectorAll('select');
                var itemsInnerProj = Array.prototype.map.call(itemsInner, function (item) {
                    return {
                        tagName: item.tagName,
                        id: item.id,
                        className: item.className,
                        name: item.name,
                        selectedIndex: item.selectedIndex
                    };
                });
                return JSON.stringify(itemsInnerProj, null, 2);
            });
            this.echo(items1);

            // fill the form on the top of the bill overview frame and "submit" it (will trigger AJAX call to get the details about selected month+year period)
            this.fill('form#form1', {
                'YearDropdown': year,
                'MonthDropdown': month
            }, true);

            // wait for the link button that will display details about selected month+year period including the link to the invoice PDF
            this.waitForSelector('#OrderRepeater_ctl01_OrderDetailsLink', function() {
                this.echo("GOT DETAILS LINK");
                // then click it
                this.click('#OrderRepeater_ctl01_OrderDetailsLink');
            }, null, waitTimeout);

        });

    }, null, waitTimeout);

});

casper.then(function() {

    this.waitForSelector('div#O365MainFrame', function() {
        this.withFrame(mainFrameIframeId, function() {

            this.waitForSelector('a#InvoiceLink', function() {

                var url = this.getElementAttribute('a#InvoiceLink', 'href');
                this.echo("INVOICE PDF URL: " + url);

                this.then(function() {
                    // debugging of downloaded files
                    var pdfSaver = function(resource) {
                        casper.echo('Resource received: ' + resource.url);
                        casper.echo('- content-type: ' + resource.contentType);
                        casper.echo('- stage: ' + resource.stage);

                        // handle PDF download
                        if (resource.stage == 'start' && resource.contentType == 'application/pdf') {
                            // get filename returned by server and use it
                            var fn = resource.headers.get('Content-Disposition').replace(/.*filename=(.*)/i, '$1');
                            // use standard CasperJS download method, because resource.received event does not
                            //  provide resource content; it's used just to determine the right moment to download
                            casper.download(resource.url, fn);
                        }
                    };

                    casper.on('resource.received', pdfSaver);

                    this.then(function() {
                        this.thenOpen(url, function(response) {
                            this.wait(10000, function() {
                                casper.echo('Finished with this one: ' + response.url);
                            });
                        });
                    });
                });

            }, null, waitTimeout);

        });
    }, null, waitTimeout);

});

casper.run();
