import { OCELCountInfo } from "@r4pm/components";
import { Theme } from "@r4pm/components/ui";

// Dev-only smoke check that @r4pm/components imports, transpiles, styles, and themes correctly
// inside OCPQ. Not linked in the nav. Remove once the real track swaps land.
export default function ComponentsSmoke() {
	return (
		<Theme>
			<div style={{ padding: 24 }}>
				<h1>@r4pm/components smoke</h1>
				<OCELCountInfo
					data={{
						event_type_counts: {
							"place order": 1200,
							"pay order": 980,
							"pick item": 4300,
						},
						object_type_counts: {
							orders: 1200,
							items: 8700,
							customers: 340,
						},
					}}
				/>
			</div>
		</Theme>
	);
}
