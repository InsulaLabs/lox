export namespace main {
	
	export class KeyListResult {
	    keys: string[];
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new KeyListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.keys = source["keys"];
	        this.total = source["total"];
	    }
	}

}

