export interface CostReport {
	provider: 'contentdynamite';
	units: number;
}

export interface ProgramOptions {
	mount?: boolean;
	reportCost?: (report: CostReport) => void;
}
